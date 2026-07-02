// =============================================================
// EAA Bridge — Rust 子进程管理器
// 负责与 eaa 二进制通信，解析 JSON 输出
// 支持 Windows / macOS / Linux 平台自适应
// 跨平台降级：二进制不可用时返回友好错误而非依赖 PATH
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import spawn from 'cross-spawn'
import { app } from 'electron'
import { debug } from '../../shared/debug'

export interface EAACommand {
  command: string
  args: string[]
  timeout?: number
  /** 显式指定是否需要 JSON 输出；不指定则按命令名自动判断 */
  jsonOutput?: boolean
}

/**
 * EAAResult — 统一返回结构
 * JSON 命令：data 为解析后的对象
 * 文本命令：data 为原始字符串
 */
export interface EAAResult<T = unknown> {
  success: boolean
  data: T | null
  stderr: string
  exitCode: number
}

/**
 * 从 EAAResult 中提取最有用的错误信息。
 * TEXT_OUTPUT_COMMANDS 失败时 CLI 的详细错误在 data（字符串）里，
 * JSON 命令失败时在 stderr 里。此函数按优先级选取。
 */
export function getErrorMessage(result: EAAResult, fallback = '未知错误'): string {
  if (typeof result.data === 'string' && result.data.length > 0) return result.data
  if (result.stderr && result.stderr.length > 0) return result.stderr
  return fallback
}

/** 已知会产生 JSON 输出的命令（其余命令如 add/revert/export/dashboard 等为文本输出） */
const JSON_COMPATIBLE_COMMANDS = new Set<string>([
  'doctor',
  'list',
  'get',
  'query',
  'search',
  'stats',
  'report',
  'find',
  'show',
  'status',
  'history',
  'summary',
  'ranking',
  'info',
  'score',
  'validate',
  'range',
  'tag',
  'codes',
  'list-students',
  'replay',
])

/** 已知会产生文本/文件输出的命令（不追加 --output json） */
const TEXT_OUTPUT_COMMANDS = new Set<string>([
  'export', // 输出 CSV/JSONL/HTML 文件
  'dashboard', // 生成 HTML 文件
  'serve', // 启动 HTTP 服务
  'init', // 初始化
  'config', // 配置
  'privacy', // 隐私子命令（嵌套命令有自己的输出格式）
  'add',
  'revert',
  'add-student',
  'delete-student',
  'set-student-meta',
  'import',
])

/**
 * EAA CLI export 命令支持的导出格式（静态降级列表）。
 * 与 Rust 源码 core/eaa-cli/src/commands.rs 的 cmd_export() 同步：
 *   Rust 仅支持 csv / jsonl / html 三种格式。
 * 当 EAA 二进制可用时，getSupportedExportFormats() 会动态探测实际支持的格式，
 * 此常量仅作为二进制不可用或探测失败时的降级。
 */
export const SUPPORTED_EXPORT_FORMATS = ['csv', 'jsonl', 'html'] as const
export type ExportFormat = (typeof SUPPORTED_EXPORT_FORMATS)[number]

/** 所有其他命令均视为 JSON 兼容命令，自动追加 --output json */

// 平台 → 二进制目录名映射
const PLATFORM_DIR: Record<string, string> = {
  'win32-x64': 'win32-x64',
  'win32-arm64': 'win32-x64', // ARM 回退到 x64
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
}

// 平台 → 可执行文件名
const BINARY_NAME: Record<string, string> = {
  win32: 'eaa.exe',
  darwin: 'eaa',
  linux: 'eaa',
}

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
   * RISK 7 修复: 需要串行化的写命令集合(基于 TEXT_OUTPUT_COMMANDS 中会修改数据的命令)。
   * doctor/list/get/query 等读命令不在此集合中,可并发执行。
   */
  private static readonly WRITE_COMMANDS = new Set<string>([
    'add',
    'add-student',
    'delete-student',
    'set-student-meta',
    'revert',
    'import',
    'init',
    'config',
    'privacy',
  ])

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
    if (command !== 'privacy') return [...args]
    // privacy 子命令结构:
    //   includesCommand=false: [subcommand, ...args]  (cmd.args)
    //   includesCommand=true:  [command, subcommand, ...args]  (full args)
    const sub = includesCommand ? args[1] : args[0]
    const PASSWORD_CMDS = new Set(['init', 'load', 'disable'])
    if (!PASSWORD_CMDS.has(sub)) return [...args]
    if (includesCommand) {
      // full args: ['privacy', 'init', 'password', ...] → ['privacy', 'init', '***', ...]
      if (args.length >= 3) {
        return [args[0], args[1], '***', ...args.slice(3)]
      }
    } else {
      // cmd.args: ['init', 'password', ...] → ['init', '***', ...]
      if (args.length >= 2) {
        return [args[0], '***', ...args.slice(2)]
      }
    }
    return [...args]
  }

  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'eaa-data')
    try {
      this.binaryPath = this.resolveBinaryPath()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.binaryPath = null
      this.unavailableReason = msg
      console.error('[EAA] Binary unavailable at startup:', msg)
    }
  }

  /** 平台自适应解析二进制路径（找不到时抛错，不回退到 PATH） */
  private resolveBinaryPath(): string {
    const platform = process.platform
    const arch = process.arch
    const platformKey = `${platform}-${arch}`
    const dirName = PLATFORM_DIR[platformKey]
    const binName = BINARY_NAME[platform]

    if (!dirName || !binName) {
      throw new Error(
        `EAA binary not available for platform ${platform}-${arch}. ` +
          `Supported: win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64.`,
      )
    }

    // 优先检查 dev 路径(项目根 resources/eaa-binaries/) — 即使 app.isPackaged 为 true,
    // 用 `electron .` 启动 packaged-asar 之外的项目时,app.isPackaged 不可靠,
    // 此时 process.resourcesPath 指向 electron 自带的 resources 目录,而非项目 resources/。
    const devResourcePath = path.join(
      __dirname,
      '..',
      '..',
      'resources',
      'eaa-binaries',
      dirName,
      binName,
    )
    if (fs.existsSync(devResourcePath)) return devResourcePath

    // Packaged 模式:用 process.resourcesPath/eaa-binaries/
    if (app.isPackaged) {
      const packagedPath = path.join(process.resourcesPath, 'eaa-binaries', dirName, binName)
      if (fs.existsSync(packagedPath)) return packagedPath
    }

    // 回退：直接链接 education-advisor 的编译产物
    const fallbackPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'education-advisor',
      'core',
      'eaa-cli',
      'target',
      'release',
      binName,
    )
    if (fs.existsSync(fallbackPath)) return fallbackPath

    throw new Error(
      `EAA binary not found for ${platform}-${arch} (expected at ${devResourcePath} or ${fallbackPath}). ` +
        `Please run 'npm run build:eaa' or download the binary from the releases page.`,
    )
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
      // 确保数据目录存在
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
      }

      // 确保内部子目录结构存在（EAA Rust CLI 要求的固定布局）
      const subDirs = ['entities', 'events', 'logs']
      for (const sub of subDirs) {
        const subPath = path.join(this.dataDir, sub)
        if (!fs.existsSync(subPath)) {
          fs.mkdirSync(subPath, { recursive: true })
        }
      }

      // 确保核心数据文件存在（空结构）
      const entitiesPath = path.join(this.dataDir, 'entities', 'entities.json')
      if (!fs.existsSync(entitiesPath)) {
        const emptyEntities = JSON.stringify(
          {
            version: '1.0',
            base_score: 100.0,
            entities: {},
          },
          null,
          2,
        )
        fs.writeFileSync(entitiesPath, emptyEntities, 'utf-8')
        console.log('[EAA] Created empty entities/entities.json')
      }

      const eventsPath = path.join(this.dataDir, 'events', 'events.json')
      if (!fs.existsSync(eventsPath)) {
        fs.writeFileSync(eventsPath, '[]', 'utf-8')
        console.log('[EAA] Created empty events/events.json')
      }

      const nameIndexPath = path.join(this.dataDir, 'entities', 'name_index.json')
      if (!fs.existsSync(nameIndexPath)) {
        fs.writeFileSync(nameIndexPath, '{}', 'utf-8')
        console.log('[EAA] Created empty entities/name_index.json')
      }

      // 确保 reason-codes 配置文件存在
      if (!fs.existsSync(schemaDir)) {
        fs.mkdirSync(schemaDir, { recursive: true })
      }
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
    const convertReasonCodes = (raw: string): string => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const pAny = parsed as { codes?: unknown; version?: unknown }
        if (pAny.codes && typeof pAny.codes === 'object') {
          return JSON.stringify(parsed, null, 2)
        }
        const out: {
          version: string
          codes: Record<string, { label: string; category: string; score_delta: number }>
        } = { version: '1.0', codes: {} }
        for (const [code, defAny] of Object.entries(parsed)) {
          const def = defAny as {
            label?: unknown
            category?: unknown
            delta?: unknown
            score_delta?: unknown
          }
          if (!def || typeof def !== 'object') continue
          out.codes[code] = {
            label: typeof def.label === 'string' ? def.label : code,
            category: typeof def.category === 'string' ? def.category : 'deduct',
            score_delta:
              typeof def.score_delta === 'number'
                ? def.score_delta
                : typeof def.delta === 'number'
                  ? def.delta
                  : 0,
          }
        }
        return JSON.stringify(out, null, 2)
      } catch {
        return raw
      }
    }
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
   */
  async execute<T = unknown>(cmd: EAACommand): Promise<EAAResult<T>> {
    // High 1.1 修复: ENOENT 后 binaryPath 永久 null,此处尝试重新 resolve
    // 之前一旦发生 ENOENT(如二进制被杀软临时隔离),binaryPath 被置 null,
    // 即使二进制后来恢复,也必须重启 app 才能继续使用 EAA 功能。
    // 现在每次 execute 入口若 binaryPath 为 null,尝试重新 resolve 一次。
    if (!this.binaryPath) {
      try {
        const recovered = this.resolveBinaryPath()
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
    const isWrite = EAABridge.WRITE_COMMANDS.has(cmd.command)
    if (!isWrite) {
      // MEDIUM 修复: 读命令等待当前活跃写完成,避免读到写期间的不一致 JSON
      // 注意: 只 await 当前 writeQueue 快照,不把自己加入队列(读命令之间仍可并发)
      // 若 await 期间有新写命令进入,新写命令会接到 writeQueue 尾部,
      // 本读命令不会阻塞新写命令,但本读命令可能读到新写命令开始前的状态。
      // 这是可接受的:读命令获得的是"调用时刻 + 排队中的写完成"后的快照,
      // 符合"调用前已提交的写操作对本次读可见"的语义。
      await this.writeQueue
      return this._doExecute<T>(cmd)
    }

    // 写命令: 通过 writeQueue Promise 链串行化
    // 每次将一个待触发的 runPromise 接到队列尾部,等待前一个队列完成后才执行本次,
    // 执行结束(无论成功失败)后 resolve runPromise 以放行下一个写命令。
    const run = () => this._doExecute<T>(cmd)
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
      return await run()
    } finally {
      resolveRun()
    }
  }

  /**
   * 实际执行 EAA 命令的子进程逻辑(从 execute 抽取)。
   * 调用前 execute 已完成 binaryPath 重新 resolve 和 unavailable 检查。
   * 写命令由 execute 通过 writeQueue 串行化后调用,读命令直接调用。
   */
  private _doExecute<T = unknown>(cmd: EAACommand): Promise<EAAResult<T>> {
    const startTime = debug.eaa ? Date.now() : 0

    return new Promise((resolve) => {
      // 根据命令名决定是否追加 --output json
      let args: string[]
      if (cmd.jsonOutput === true) {
        args = [cmd.command, ...cmd.args, '--output', 'json']
      } else if (cmd.jsonOutput === false) {
        args = [cmd.command, ...cmd.args]
      } else if (JSON_COMPATIBLE_COMMANDS.has(cmd.command)) {
        args = [cmd.command, ...cmd.args, '--output', 'json']
      } else if (TEXT_OUTPUT_COMMANDS.has(cmd.command)) {
        args = [cmd.command, ...cmd.args]
      } else {
        // 未知命令：默认追加 --output json（所有 EAA 命令都支持全局 -O/--output 选项）
        args = [cmd.command, ...cmd.args, '--output', 'json']
      }

      if (debug.eaa) {
        // High 修复: privacy init/load/disable 命令的 args 中包含明文密码(位置参数),
        // 直接打印会泄露到主进程日志文件,需要脱敏
        // 注意: cmd.args 不含命令名(结构 ['init', 'password']),
        //       args 含命令名(结构 ['privacy', 'init', 'password']),
        //       两者都需要脱敏,但 sanitizeArgsForLog 需要区分
        const safeArgs = EAABridge.sanitizeArgsForLog(cmd.command, cmd.args, false)
        const safeFullArgs = EAABridge.sanitizeArgsForLog(cmd.command, args, true)
        console.log('[debug:eaa] spawn', {
          command: cmd.command,
          args: safeArgs,
          fullArgs: safeFullArgs,
          timeout: cmd.timeout ?? 30_000,
        })
      }

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        EAA_DATA_DIR: this.dataDir,
      }
      if (this.privacyPassword) {
        env.EAA_PRIVACY_PASSWORD = this.privacyPassword
      }

      const proc = spawn(this.binaryPath as string, args, {
        cwd: this.dataDir,
        env,
        timeout: cmd.timeout ?? 30_000,
        windowsHide: true,
      })

      // MEDIUM 修复: stdout/stderr 设置 50MB/10MB 累积上限,溢出时截断并 kill 子进程,防止 OOM
      const MAX_STDOUT_BYTES = 50 * 1024 * 1024
      const MAX_STDERR_BYTES = 10 * 1024 * 1024
      let stdout = ''
      let stderr = ''
      let stdoutTruncated = false
      let stderrTruncated = false

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutTruncated) return
        stdout += chunk.toString()
        if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) {
          stdout += '\n[... stdout truncated at 50MB ...]'
          stdoutTruncated = true
          try {
            proc.kill('SIGTERM')
          } catch {
            /* already exited */
          }
        }
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        if (stderrTruncated) return
        stderr += chunk.toString()
        if (Buffer.byteLength(stderr) > MAX_STDERR_BYTES) {
          stderr += '\n[... stderr truncated at 10MB ...]'
          stderrTruncated = true
          try {
            proc.kill('SIGTERM')
          } catch {
            /* already exited */
          }
        }
      })

      proc.on('close', (code) => {
        const exitCode = code ?? -1
        const success = exitCode === 0

        if (debug.eaa) {
          const elapsed = Date.now() - startTime
          const stdoutPreview =
            stdout.length > 500 ? `${stdout.slice(0, 500)}... (${stdout.length} chars)` : stdout
          const stderrPreview =
            stderr.length > 500 ? `${stderr.slice(0, 500)}... (${stderr.length} chars)` : stderr
          console.log('[debug:eaa] close', {
            command: cmd.command,
            exitCode,
            success,
            elapsedMs: elapsed,
            stdoutPreview,
            stderrPreview,
          })
        }

        // 解析 stdout：仅当追加了 --output json 时尝试 JSON.parse
        if (args.includes('--output') && args.includes('json')) {
          try {
            const value = JSON.parse(stdout) as T
            resolve({ success, data: value, stderr, exitCode })
            return
          } catch {
            // JSON 解析失败：data 设为 null
            resolve({ success, data: null, stderr, exitCode })
            return
          }
        }

        // 非 JSON 命令：直接返回原始文本作为 data
        resolve({
          success,
          data: (stdout.trim() || stderr.trim()) as T | null,
          stderr,
          exitCode,
        })
      })

      proc.on('error', (err) => {
        if (debug.eaa) {
          console.error('[debug:eaa] spawn error', {
            command: cmd.command,
            error: err.message,
            code: (err as NodeJS.ErrnoException).code,
          })
        }
        // ENOENT 触发时更新 unavailable 状态
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.unavailableReason = `EAA binary disappeared: ${err.message}`
          this.binaryPath = null
        }
        resolve({
          success: false,
          data: null,
          stderr: err.message,
          exitCode: -1,
        })
      })
    })
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
          const formats = this.parseExportFormatsFromHelp(helpText)
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

  /**
   * 从 `eaa export --help` 输出中解析支持的格式。
   * 帮助文本通常包含类似 "导出格式: csv(默认), jsonl, html" 的描述。
   *
   * R29-2 修复: 之前 knownFormats 包含 'json', 但 EAA Rust 二进制实际不支持 json 导出
   * (cmd_export 只支持 csv/jsonl/html)。帮助文本中可能出现 "JSON" 字样(如描述 jsonl 时),
   * 导致误判。现在只检测静态列表中已确认支持的格式, 避免误报。
   */
  private parseExportFormatsFromHelp(helpText: string): string[] {
    const found: string[] = []

    // 只检测静态列表中已确认支持的格式, 不猜测新格式
    for (const fmt of SUPPORTED_EXPORT_FORMATS) {
      // 使用 word boundary 确保不匹配子串（如 "csv" 不匹配 "csvfile"）
      const regex = new RegExp(`\\b${fmt}\\b`, 'i')
      if (regex.test(helpText)) {
        found.push(fmt)
      }
    }

    // 确保至少包含静态列表中的格式（以防帮助文本格式变化）
    for (const fmt of SUPPORTED_EXPORT_FORMATS) {
      if (!found.includes(fmt)) found.push(fmt)
    }

    return found
  }

  /** 获取二进制路径（不可用时返回 null） */
  getBinaryPath(): string | null {
    return this.binaryPath
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized
  }
}

export const eaaBridge = new EAABridge()
