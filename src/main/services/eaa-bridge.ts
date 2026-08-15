// =============================================================
// EAA Bridge — Rust 子进程管理器（编排层）
// 负责与 eaa 二进制通信，解析 JSON 输出
// 支持 Windows / macOS / Linux 平台自适应
// 跨平台降级：二进制不可用时返回友好错误而非依赖 PATH
//
// 纯逻辑已按职责拆分到 ./eaa/ 子模块：
//   eaa/types.ts               类型 + getErrorMessage + 导出格式常量
//   eaa/command-classification.ts  命令分类 + 参数脱敏 + args 构建
//   eaa/platform.ts            平台常量 + 二进制路径解析
//   eaa/process-executor.ts    子进程 spawn/超时/输出捕获
//   eaa/output-parser.ts       stdout 解析/错误归一化
//   eaa/legacy-migration.ts    数据目录解析 + legacy 迁移
// 本文件保留 EAABridge 编排层与全部公共 API（行为零变化）
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { debug } from '@shared/debug'
import type spawn from 'cross-spawn'
import { app } from 'electron'
import { sanitizeArgsForLog, WRITE_COMMANDS } from './eaa/command-classification'
import {
  cleanupStaleLock,
  convertReasonCodes,
  ensureDataDirStructure,
  resolveDataDir,
} from './eaa/legacy-migration'
import { parseExportFormatsFromHelp } from './eaa/output-parser'
import { resolveBinaryPath } from './eaa/platform'
import type { ProcessExecutorContext } from './eaa/process-executor'
import { executeProcess } from './eaa/process-executor'
import type { EAACommand, EAAResult } from './eaa/types'
import { SUPPORTED_EXPORT_FORMATS } from './eaa/types'

// 类型、getErrorMessage、SUPPORTED_EXPORT_FORMATS、ExportFormat 由此 re-export,
// 保证所有旧命名导入（eaaBridge/getErrorMessage/EAABridge 等）不变
export * from './eaa/types'

export class EAABridge {
  private binaryPath: string | null = null
  private dataDir: string
  private privacyPassword?: string
  private initialized = false
  /** 缓存动态探测到的导出格式（避免每次调用都 spawn 子进程） */
  private cachedExportFormats: readonly string[] | null = null
  /**
   * H-6 修复: 并发调用 getSupportedExportFormats 时复用同一个 in-flight Promise,
   * 避免多次并发 spawn `eaa export --help` 浪费资源并可能产生竞态。
   */
  private exportFormatsInFlight: Promise<readonly string[]> | null = null
  /**
   * 二进制不可用时记录原因；execute() 会先检查这个状态，
   * 立即返回失败而不调用 spawn()，避免产生难看的 ENOENT。
   */
  private unavailableReason: string | null = null
  /**
   * High 1.1 修复: ENOENT 后允许重新探测二进制路径。
   * 之前 binaryPath 一旦被置 null,即使二进制被恢复也无法继续使用,
   * 必须重启 app 才能恢复。现在每次 execute 入口都尝试重新 resolve。
   */

  /**
   * RISK 7 修复: 写命令串行化队列。
   * EAA 二进制并发写 JSON 文件可能丢数据,所有写命令通过此 Promise 链串行执行。
   * 读命令(JSON_COMPATIBLE_COMMANDS)不需串行化,可直接并发 spawn。
   */
  private writeQueue: Promise<void> = Promise.resolve()
  /**
   * 读命令结果缓存（TTL 制）。
   * EAA 读命令每次都要 spawn 一个新进程并重新解析磁盘上的 entities/events JSON，
   * 切换页面时反复拉取造成明显卡顿（仪表盘一次 7 个 spawn、学生页 1 个）。
   * 读命令命中缓存即直接返回，写命令（含 forceRefresh）清除整个缓存。
   * key = `${command}:${args.join(' ')}`，value = { result, expireAt }。
   */
  private readCache = new Map<string, { result: EAAResult; expireAt: number }>()
  /** 读缓存有效期（毫秒）。10 秒：足以覆盖页面来回切换，写操作即时失效。 */
  private static readonly READ_CACHE_TTL = 10_000
  /** 超过此条数的读缓存视为异常增长，清空并告警（防止内存泄漏）。 */
  private static readonly READ_CACHE_MAX = 64
  /**
   * P1-10: 活跃子进程注册表。
   * EAA 是 spawn-per-command, 进程短生命周期, 但应用退出时若有 in-flight 进程,
   * 退出后这些子进程可能成为孤儿(Windows 不自动 kill), 并持有 .lock 文件
   * 导致下次启动时 stale lock 阻塞。shutdown() 时遍历此 Set 终止所有 in-flight 进程。
   */
  private activeProcesses: Set<ReturnType<typeof spawn>> = new Set()

  /**
   * F1: 写命令成功回调(可选)。
   * Agent 工具(eaa/tools)与飞书 runEAA 直接调 eaaBridge.execute 写数据后,
   * ipc 层的 studentsCache/rankingCache/scoreCache/staticCache 无法感知——
   * 通过此桥接层钩子通知(零分层污染:ipc 层注册回调,bridge 不 import ipc)。
   * 幂等:重复调用 onWriteCommand 覆盖前一个回调。
   */
  private writeListener?: () => void

  /**
   * F1: 注册写命令成功回调(如 ipc 层缓存失效)。
   * 回调异常会被捕获并告警,不影响命令结果返回。
   */
  onWriteCommand(cb: () => void): void {
    this.writeListener = cb
  }

  /** 生成读缓存键 */
  private readCacheKey(cmd: EAACommand): string {
    return `${cmd.command}:${cmd.args.join(' ')}`
  }

  /** 清空读缓存（供「刷新」按钮调用，确保下次读取重新拉取） */
  invalidateReadCache(): void {
    this.readCache.clear()
  }

  /**
   * R135 新增: 延迟 helper,用于 os error 5 重试前等待 Windows Defender/AV 释放文件
   * Defender 实时扫描通常在 50-200ms 内完成,这里用 100ms 平衡速度与成功率
   */
  private static readonly OS_ERROR5_RETRY_DELAY_MS = 100

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  /**
   * RISK 7 修复: 需要串行化的写命令集合(WRITE_COMMANDS)已拆分到
   * eaa/command-classification.ts(逻辑逐字保留)。
   */

  /**
   * High 修复: 对包含敏感信息(密码)的命令参数做脱敏,避免泄露到日志文件。
   * privacy init/load/disable 命令的位置参数 0/1 是明文密码,需要替换为 ***。
   * 静态方法,不依赖实例状态,方便单测。
   *
   * @param command EAA 命令名(如 'privacy')
   * @param args 参数数组
   * @param includesCommand args[0] 是否是命令名(即 args 结构为 ['privacy', 'init', 'password'])
   *                        false: args 结构为 ['init', 'password'](cmd.args)
   *                        true:  args 结构为 ['privacy', 'init', 'password'](full args)
   */
  static sanitizeArgsForLog(
    command: string,
    args: readonly string[],
    includesCommand = false,
  ): string[] {
    return sanitizeArgsForLog(command, args, includesCommand)
  }

  constructor() {
    // __dirname 在编排层求值后传参,保证子模块中项目根解析与拆分前一致
    this.dataDir = resolveDataDir(__dirname)
    try {
      this.binaryPath = resolveBinaryPath(__dirname)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.binaryPath = null
      this.unavailableReason = msg
      console.error('[EAA] Binary unavailable at startup:', msg)
    }
  }

  /** 设置隐私引擎密码（通过环境变量传递） */
  setPrivacyPassword(password: string) {
    this.privacyPassword = password
  }

  /** 清空内存中的隐私密码（锁定隐私引擎） */
  clearPrivacyPassword() {
    this.privacyPassword = undefined
  }

  /** 查询隐私引擎是否已加载密码（不解密/不返回密码本身） */
  hasPrivacyPassword(): boolean {
    return typeof this.privacyPassword === 'string' && this.privacyPassword.length >= 4
  }

  /**
   * EAA 二进制是否就绪（已找到并可执行）
   * 调用方在 IPC handler 中应先检查此状态以提供友好提示
   */
  isAvailable(): boolean {
    return this.binaryPath !== null
  }

  /** 获取二进制不可用的原因（可用时为 null） */
  getUnavailableReason(): string | null {
    return this.unavailableReason
  }

  /** 初始化：创建数据目录及内部结构，运行 doctor 检查 */
  async initialize(): Promise<{ healthy: boolean; message: string }> {
    // RISK 3 修复: dataDir 只读时 fs 操作会抛异常阻塞 app 启动,
    // 这里用 try/catch 包裹所有目录/文件初始化操作,失败时降级返回 unhealthy。
    // 注意: parentDir/schemaDir 在 try 外声明,因为后续 copyFileSync 段还要使用 schemaDir。
    // EAA Rust CLI get_schema_dir() 会在 dataDir 的**父目录**中寻找 schema/reason_codes.json
    const parentDir = path.dirname(this.dataDir)
    const schemaDir = path.join(parentDir, 'schema')
    try {
      // 确保数据目录/内部结构存在 + 清理 stale .lock(逻辑拆分到 eaa/legacy-migration.ts)
      ensureDataDirStructure(this.dataDir, schemaDir)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[EAA] Failed to initialize EAA data dir:', msg)
      this.unavailableReason = `EAA data dir unavailable: ${msg}`
      this.initialized = true
      return { healthy: false, message: this.unavailableReason }
    }

    const codesSrc = app.isPackaged
      ? path.join(process.resourcesPath, 'config', 'reason-codes.json')
      : path.join(__dirname, '..', '..', 'config', 'reason-codes.json')

    // 转换并复制 reason-codes.json (P-fix: project flat schema -> Rust nested schema)
    // 项目根 config/reason-codes.json 是 flat 格式: { CODE: { label, category, delta } }
    // Rust EAA CLI 期望嵌套格式: { version, codes: { CODE: { label, category, score_delta } } }
    // 转换: 读源 JSON -> 包装成 { version, codes: {...} } -> 复制到两处
    // (转换逻辑拆分到 eaa/legacy-migration.ts 的 convertReasonCodes)
    const schemaCodesDst = path.join(schemaDir, 'reason_codes.json')
    if (fs.existsSync(codesSrc) && !fs.existsSync(schemaCodesDst)) {
      try {
        const converted = convertReasonCodes(fs.readFileSync(codesSrc, 'utf-8'))
        fs.writeFileSync(schemaCodesDst, converted, 'utf-8')
        console.log('[EAA] Converted + wrote reason-codes.json to schema dir')
      } catch (err) {
        console.warn('[EAA] Failed to write reason-codes.json to schema dir:', err)
      }
    }

    // 也复制到数据目录（备用路径）
    const codesDst = path.join(this.dataDir, 'reason_codes.json')
    if (fs.existsSync(codesSrc) && !fs.existsSync(codesDst)) {
      try {
        const converted = convertReasonCodes(fs.readFileSync(codesSrc, 'utf-8'))
        fs.writeFileSync(codesDst, converted, 'utf-8')
        console.log('[EAA] Converted + wrote reason-codes.json to data dir')
      } catch (err) {
        console.warn('[EAA] Failed to write reason-codes.json:', err)
      }
    }

    // 如果二进制不可用，跳过 doctor 直接返回降级状态
    if (!this.isAvailable()) {
      this.initialized = true
      return {
        healthy: false,
        message:
          this.unavailableReason || 'EAA binary not available. Some features will be disabled.',
      }
    }

    // 运行 doctor 健康检查
    try {
      const result = await this.execute({ command: 'doctor', args: [], timeout: 10_000 })
      this.initialized = true
      if (result.success) {
        console.log('[EAA] Doctor check passed')
        return { healthy: true, message: 'EAA ready' }
      }
      // doctor 可能因为数据为空而警告，但不影响使用
      console.log(
        '[EAA] Doctor warnings (non-fatal):',
        result.stderr || JSON.stringify(result.data),
      )
      return { healthy: true, message: 'EAA ready (with warnings)' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[EAA] Doctor check failed:', msg)
      // 不阻塞启动——EAA 命令可能在后续成功
      this.initialized = true
      return { healthy: false, message: msg }
    }
  }

  /**
   * 执行 EAA 命令，返回结构化结果
   * - JSON 兼容命令：自动追加 --output json
   * - 文本输出命令：不追加
   * - 显式指定 jsonOutput 优先
   * - DEBUG_EAA=1 时输出 stdin/stdout/stderr/exitCode/timing
   *
   * RISK 7 修复: 写命令(WRITE_COMMANDS)通过 writeQueue 串行化,
   * 避免 EAA 二进制并发写 JSON 文件丢数据;读命令直接并发执行。
   *
   * F4: opts.signal 支持 AbortSignal(pi-agent-core 工具执行透传):
   * 已 abort 则不 spawn 直接失败;执行中 abort 则 kill 子进程并返回 aborted。
   */
  async execute<T = unknown>(
    cmd: EAACommand,
    opts?: { signal?: AbortSignal },
  ): Promise<EAAResult<T>> {
    // High 1.1 修复: ENOENT 后 binaryPath 永久 null,此处尝试重新 resolve
    // 之前一旦发生 ENOENT(如二进制被杀软临时隔离),binaryPath 被置 null,
    // 即使二进制后来恢复,也必须重启 app 才能继续使用 EAA 功能。
    // 现在每次 execute 入口若 binaryPath 为 null,尝试重新 resolve 一次。
    if (!this.binaryPath) {
      try {
        const recovered = resolveBinaryPath(__dirname)
        if (recovered) {
          this.binaryPath = recovered
          this.unavailableReason = null
          console.log('[EAA] Binary path recovered after re-resolve:', recovered)
        }
      } catch {
        /* 重新 resolve 仍然失败,保持 null 状态 */
      }
    }

    // 二进制不可用时立即返回失败，不调用 spawn
    if (!this.binaryPath) {
      if (debug.eaa) {
        console.warn('[debug:eaa] execute skipped (binary unavailable)', {
          command: cmd.command,
          args: EAABridge.sanitizeArgsForLog(cmd.command, cmd.args, false),
        })
      }
      return {
        success: false,
        data: null,
        stderr: this.unavailableReason || 'EAA binary not available',
        exitCode: -1,
      }
    }

    // RISK 7 修复 + MEDIUM 修复: 写命令串行化,避免 EAA 二进制并发写 JSON 文件丢数据
    const isWrite = WRITE_COMMANDS.has(cmd.command)
    if (!isWrite) {
      // 读命令缓存：命中且未过期则直接返回，避免重复 spawn（切页面秒开）
      if (!cmd.forceRefresh) {
        const cached = this.readCache.get(this.readCacheKey(cmd))
        if (cached && cached.expireAt > Date.now()) {
          return cached.result as EAAResult<T>
        }
      }
      // MEDIUM 修复: 读命令等待当前活跃写完成,避免读到写期间的不一致 JSON
      // 注意: 只 await 当前 writeQueue 快照,不把自己加入队列(读命令之间仍可并发)
      // 若 await 期间有新写命令进入,新写命令会接到 writeQueue 尾部,
      // 本读命令不会阻塞新写命令,但本读命令可能读到新写命令开始前的状态。
      // 这是可接受的:读命令获得的是"调用时刻 + 排队中的写完成"后的快照,
      // 符合"调用前已提交的写操作对本次读可见"的语义。
      await this.writeQueue
      let result = await this._doExecute<T>(cmd, opts?.signal)
      // R152 修复 + R135 强化: 如果读命令因 "os error 5"(Access Denied) 失败,
      // 不依赖 cleanupStaleLock 返回值(Defender 拦截时 lock 文件可能不存在或 mtime 很新),
      // 直接延迟 100ms 后重试一次。重试最多 2 次,覆盖 Defender 扫描窗口。
      if (!result.success && result.stderr && result.stderr.includes('os error 5')) {
        cleanupStaleLock(this.dataDir) // 尽力清理,不依赖返回值
        for (let attempt = 1; attempt <= 2; attempt++) {
          await this.delay(EAABridge.OS_ERROR5_RETRY_DELAY_MS)
          console.warn(
            `[EAA] Retrying read "${cmd.command}" (attempt ${attempt}/2) after os error 5`,
          )
          result = await this._doExecute<T>(cmd, opts?.signal)
          if (result.success || !result.stderr || !result.stderr.includes('os error 5')) break
        }
      }
      // P1-9 修复: JSON 命令并发文件锁竞争时 stdout 可能为空(退出码 0 但无输出)。
      // _doExecute 已把这种情况标记为 success=false + stderr 含 [EAA_EMPTY_STDOUT]。
      // 这里对读命令做最多 2 次重试, 退避递增 80ms*(attempt+1) 以错开并发峰值。
      if (!result.success && result.stderr && result.stderr.includes('[EAA_EMPTY_STDOUT]')) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await this.delay(80 * (attempt + 1))
          console.warn(
            `[EAA] Retrying read "${cmd.command}" (attempt ${attempt}/2) after empty stdout`,
          )
          result = await this._doExecute<T>(cmd, opts?.signal)
          if (!result.success || !result.stderr?.includes('[EAA_EMPTY_STDOUT]')) {
            break
          }
        }
      }
      // 仅缓存成功结果（失败重试更有意义）
      if (result.success) {
        const key = this.readCacheKey(cmd)
        if (this.readCache.size >= EAABridge.READ_CACHE_MAX) this.readCache.clear()
        this.readCache.set(key, { result, expireAt: Date.now() + EAABridge.READ_CACHE_TTL })
      }
      return result
    }

    // 写命令: 先清读缓存（数据已变更，旧缓存不再有效）
    if (this.readCache.size > 0) this.readCache.clear()
    // 写命令前清理 stale lock(写命令也需要获取锁)
    cleanupStaleLock(this.dataDir)
    // 写命令: 通过 writeQueue Promise 链串行化
    // 每次将一个待触发的 runPromise 接到队列尾部,等待前一个队列完成后才执行本次,
    // 执行结束(无论成功失败)后 resolve runPromise 以放行下一个写命令。
    const run = () => this._doExecute<T>(cmd, opts?.signal)
    let resolveRun!: () => void
    const runPromise = new Promise<void>((res) => {
      resolveRun = res
    })
    const prevQueue = this.writeQueue
    // LOW 修复: prevQueue 理论上不会 reject(每个环节只有 resolve 路径),
    // 但防御性用 .catch(() => {}) 吞掉潜在 rejection,避免 await prevQueue 抛未捕获异常。
    // 注意: runPromise 永远 resolve(只有 res 没有 rej),所以 writeQueue 链不会因本次 reject。
    this.writeQueue = prevQueue.then(() => runPromise)
    await prevQueue.catch(() => {})
    try {
      let result = await run()
      // R152 修复 + R135 强化: 写命令也可能因 "os error 5" 失败,
      // 不依赖 cleanupStaleLock 返回值,延迟后重试最多 2 次
      if (!result.success && result.stderr && result.stderr.includes('os error 5')) {
        cleanupStaleLock(this.dataDir)
        for (let attempt = 1; attempt <= 2; attempt++) {
          await this.delay(EAABridge.OS_ERROR5_RETRY_DELAY_MS)
          console.warn(
            `[EAA] Retrying write "${cmd.command}" (attempt ${attempt}/2) after os error 5`,
          )
          result = await run()
          if (result.success || !result.stderr || !result.stderr.includes('os error 5')) break
        }
      }
      // P1-9 修复: 写命令若返回空 stdout(JSON 命令)同样重试
      if (!result.success && result.stderr && result.stderr.includes('[EAA_EMPTY_STDOUT]')) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await this.delay(80 * (attempt + 1))
          console.warn(
            `[EAA] Retrying write "${cmd.command}" (attempt ${attempt}/2) after empty stdout`,
          )
          result = await run()
          if (result.success || !result.stderr || !result.stderr.includes('[EAA_EMPTY_STDOUT]')) {
            break
          }
        }
      }
      // F1: 写命令成功后通知监听方(如 ipc 层缓存失效)。
      // try/catch 保证监听方异常不影响命令结果返回。
      if (result.success) {
        try {
          this.writeListener?.()
        } catch (err) {
          console.warn(
            '[EAA] write listener failed:',
            err instanceof Error ? err.message : String(err),
          )
        }
      }
      return result
    } finally {
      resolveRun()
    }
  }

  /**
   * 实际执行 EAA 命令的子进程逻辑(从 execute 抽取)。
   * 调用前 execute 已完成 binaryPath 重新 resolve 和 unavailable 检查。
   * 写命令由 execute 通过 writeQueue 串行化后调用,读命令直接调用。
   * (spawn/超时/输出捕获逻辑拆分到 eaa/process-executor.ts,逻辑逐字保留)
   * F4: signal 透传给 process-executor(已 abort 不 spawn / 执行中 abort kill)
   */
  private _doExecute<T = unknown>(cmd: EAACommand, signal?: AbortSignal): Promise<EAAResult<T>> {
    const ctx: ProcessExecutorContext = {
      binaryPath: this.binaryPath as string,
      dataDir: this.dataDir,
      privacyPassword: this.privacyPassword,
      activeProcesses: this.activeProcesses,
      onBinaryDisappeared: (message) => {
        this.unavailableReason = `EAA binary disappeared: ${message}`
        this.binaryPath = null
      },
      signal,
    }
    return executeProcess<T>(cmd, ctx)
  }

  /** 获取数据目录路径 */
  getDataDir(): string {
    return this.dataDir
  }

  /**
   * 动态获取 EAA CLI export 命令支持的导出格式。
   *
   * 实现策略：
   *   1. 若二进制可用，运行 `eaa export --help` 并解析帮助文本中的格式列表
   *   2. 解析失败或二进制不可用时，降级到静态 SUPPORTED_EXPORT_FORMATS
   *   3. 结果缓存，后续调用直接返回缓存值
   *
   * 这样当 EAA 升级新增格式时，前端无需改动即可自动适配。
   *
   * H-6 修复: 并发调用时复用 in-flight Promise,避免多次 spawn。
   */
  async getSupportedExportFormats(): Promise<readonly string[]> {
    // 已缓存则直接返回
    if (this.cachedExportFormats) return this.cachedExportFormats

    // H-6 修复: 已有 in-flight 请求则复用,避免并发 spawn
    if (this.exportFormatsInFlight) return this.exportFormatsInFlight

    // 二进制不可用时降级到静态列表
    if (!this.isAvailable()) {
      return SUPPORTED_EXPORT_FORMATS
    }

    // H-6 修复: 把整个探测流程封装成 Promise 并存到 in-flight 字段,
    // 这样并发调用都会等待同一个 Promise 完成
    this.exportFormatsInFlight = (async () => {
      try {
        // 运行 `eaa export --help`，不追加 --output json（--help 是 clap 内置）
        const result = await this.execute({
          command: 'export',
          args: ['--help'],
          jsonOutput: false,
          timeout: 5_000,
        })

        if (result.success && typeof result.data === 'string') {
          const helpText = result.data
          const formats = parseExportFormatsFromHelp(helpText)
          if (formats.length > 0) {
            this.cachedExportFormats = formats
            if (debug.eaa) {
              console.log('[debug:eaa] dynamically detected export formats:', formats)
            }
            return formats
          }
        }
      } catch (err) {
        console.warn(
          '[EAA] Failed to dynamically probe export formats, using static list:',
          err instanceof Error ? err.message : String(err),
        )
      }

      // 降级到静态列表
      this.cachedExportFormats = SUPPORTED_EXPORT_FORMATS
      return SUPPORTED_EXPORT_FORMATS
    })()

    try {
      return await this.exportFormatsInFlight
    } finally {
      // 探测完成后清空 in-flight(无论成功失败),后续调用走缓存或重新探测
      this.exportFormatsInFlight = null
    }
  }

  /** 获取二进制路径（不可用时返回 null） */
  getBinaryPath(): string | null {
    return this.binaryPath
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * P1-10: 应用退出时的优雅关闭。
   *   1. 终止所有 in-flight EAA 子进程(SIGTERM → 不等待, 退出进程自然结束)
   *      避免退出后子进程成为孤儿并持有 .lock 文件
   *   2. 清空读缓存(释放内存)
   *   3. 清空隐私密码(安全)
   *
   * EAA 是 spawn-per-command, 进程短生命周期, 通常退出时已无 in-flight 进程。
   * 但若退出时恰好有 agent 在调用 EAA 工具, 这些进程需要被显式终止。
   */
  shutdown(): void {
    if (this.activeProcesses.size > 0) {
      console.log(`[EAA] shutdown: terminating ${this.activeProcesses.size} in-flight process(es)`)
      for (const proc of this.activeProcesses) {
        try {
          proc.kill('SIGTERM')
        } catch {
          /* already exited */
        }
      }
      this.activeProcesses.clear()
    }
    this.readCache.clear()
    this.clearPrivacyPassword()
  }
}

export const eaaBridge = new EAABridge()
