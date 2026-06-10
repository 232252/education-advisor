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
  /**
   * B-06: 服务端标记当前操作需要二次确认(例如 delete-student)
   * 仅部分 handler 返回; 渲染层可据此弹窗后再次调用
   */
  requiresConfirmation?: boolean
}

/** B-22: getErrorMessage 统一在 shared/utils.ts, 这里 re-export 保持兼容 */
export { getErrorMessage } from '../../shared/utils'

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

class EAABridge {
  private binaryPath: string | null = null
  private dataDir: string
  private privacyPassword?: string
  private initialized = false
  /**
   * 二进制不可用时记录原因；execute() 会先检查这个状态，
   * 立即返回失败而不调用 spawn()，避免产生难看的 ENOENT。
   */
  private unavailableReason: string | null = null

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

    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'eaa-binaries', dirName, binName)
    }

    // 开发模式：先找 resources/eaa-binaries
    const resourcePath = path.join(
      __dirname,
      '..',
      '..',
      'resources',
      'eaa-binaries',
      dirName,
      binName,
    )
    if (fs.existsSync(resourcePath)) return resourcePath

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
      `EAA binary not found for ${platform}-${arch} (expected at ${resourcePath}). ` +
        `Please run 'npm run build:eaa' or download the binary from the releases page.`,
    )
  }

  /** 设置隐私引擎密码（通过环境变量传递） */
  setPrivacyPassword(password: string) {
    this.privacyPassword = password
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
    // EAA Rust CLI get_schema_dir() 会在 dataDir 的**父目录**中寻找 schema/reason_codes.json
    const parentDir = path.dirname(this.dataDir)
    const schemaDir = path.join(parentDir, 'schema')
    if (!fs.existsSync(schemaDir)) {
      fs.mkdirSync(schemaDir, { recursive: true })
    }

    const codesSrc = app.isPackaged
      ? path.join(process.resourcesPath, 'config', 'reason-codes.json')
      : path.join(__dirname, '..', '..', 'config', 'reason-codes.json')

    // 修复 reason-codes 兼容性问题：
    // EAA Rust CLI 期望 schema `{ version, codes: { CODE: { label, category, score_delta } } }`，
    // 而 EA 源文件 `config/reason-codes.json` 长期使用扁平结构 + `delta` 字段名。
    // 这里在复制时做 transform，源文件保持不变。
    const transformReasonCodes = (raw: string): string => {
      try {
        const obj = JSON.parse(raw)
        // 检测是否已是新 schema（含 "codes" key）
        if (obj && typeof obj === 'object' && obj.codes && typeof obj.codes === 'object') {
          // 已经是新结构；确保 version 字段 + 字段名一致
          const out = { version: obj.version ?? '1.0', codes: {} as Record<string, unknown> }
          for (const [k, v] of Object.entries(obj.codes)) {
            const c = v as Record<string, unknown>
            out.codes[k] = {
              label: c.label,
              category: c.category,
              score_delta: c.score_delta ?? c.delta ?? null,
            }
          }
          return `${JSON.stringify(out, null, 2)}\n`
        }
        // 旧扁平结构：{ CODE: { label, category, delta } }
        const out = { version: '1.0', codes: {} as Record<string, unknown> }
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'version') {
            out.version = String(v)
            continue
          }
          const c = v as Record<string, unknown>
          out.codes[k] = {
            label: c.label,
            category: c.category,
            score_delta: c.delta ?? c.score_delta ?? null,
          }
        }
        return `${JSON.stringify(out, null, 2)}\n`
      } catch (err) {
        console.warn('[EAA] Failed to transform reason-codes.json, copying as-is:', err)
        return raw
      }
    }

    // 复制到 schema 目录（Rust get_schema_dir 的首选路径）
    const schemaCodesDst = path.join(schemaDir, 'reason_codes.json')
    // 总是刷新一份 transform 后的副本，修复 eaa.codes 报错
    if (fs.existsSync(codesSrc)) {
      try {
        const raw = fs.readFileSync(codesSrc, 'utf-8')
        const transformed = transformReasonCodes(raw)
        fs.writeFileSync(schemaCodesDst, transformed, 'utf-8')
        console.log('[EAA] Wrote transformed reason-codes.json to schema dir')
      } catch (err) {
        console.warn('[EAA] Failed to write transformed reason-codes.json to schema dir:', err)
      }
    }

    // 也复制到数据目录（备用路径）
    const codesDst = path.join(this.dataDir, 'reason_codes.json')
    if (fs.existsSync(codesSrc) && !fs.existsSync(codesDst)) {
      try {
        const raw = fs.readFileSync(codesSrc, 'utf-8')
        const transformed = transformReasonCodes(raw)
        fs.writeFileSync(codesDst, transformed, 'utf-8')
        console.log('[EAA] Wrote transformed reason-codes.json to data dir')
      } catch (err) {
        console.warn('[EAA] Failed to write transformed reason-codes.json to data dir:', err)
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
   */
  async execute<T = unknown>(cmd: EAACommand): Promise<EAAResult<T>> {
    // 二进制不可用时立即返回失败，不调用 spawn
    if (!this.binaryPath) {
      return {
        success: false,
        data: null,
        stderr: this.unavailableReason || 'EAA binary not available',
        exitCode: -1,
      }
    }

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

      // 超时安全兜底：cross-spawn 有时不杀子进程（尤其 Windows）
      const timer = setTimeout(
        () => {
          try {
            proc.kill('SIGKILL')
            proc.kill()
          } catch {
            /* already dead */
          }
        },
        (cmd.timeout ?? 30_000) + 5_000,
      )

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      let resolved = false

      proc.on('close', (code) => {
        if (resolved) return
        resolved = true
        // 清理超时兜底 timer
        clearTimeout(timer)
        const exitCode = code ?? -1
        const success = exitCode === 0

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
        if (resolved) return
        resolved = true
        clearTimeout(timer)
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
