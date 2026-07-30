// =============================================================
// Logger — 主进程全链路日志
// 5 档:debug / info / warn / error / off
// 文件: logs/main-YYYY-MM-DD.log + logs/chat-YYYY-MM-DD.log + logs/renderer-YYYY-MM-DD.log
// 支持运行时 setLevel(被 settings-handlers 触发)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'
const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, off: 99 }

// H-8 修复: 日志轮转配置
/** 保留多少天内的日志文件,超过的自动删除 */
const LOG_RETENTION_DAYS = 30
/** 每隔多少次写入触发一次轮转检查(避免每次写入都 readdir) */
const ROTATE_CHECK_INTERVAL = 100

let currentLevel: LogLevel = 'info'
let logsDir: string = path.join(app.getPath('userData'), 'logs')
/** 写入计数器,达到 ROTATE_CHECK_INTERVAL 时触发轮转 */
let writeCounter = 0
/** 上次轮转检查的时间戳(毫秒),最少间隔 1 小时避免频繁检查 */
let lastRotateCheck = 0
/**
 * L-7 修复: 轮转操作 in-flight 标志,防止并发调用同时执行轮转。
 * 多个 writeLine 调用可能同时触发 rotateLogsIfNeeded,
 * 使用 Promise 去重确保只有一个轮转操作在执行。
 */
let rotateInFlight: Promise<void> | null = null

function ensureDir(): void {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
  } catch {
    /* ignore */
  }
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel]
}

/**
 * H-8 修复: 日志轮转 — 删除超过 LOG_RETENTION_DAYS 天的旧日志文件
 * 通过文件名中的日期判断(而非 mtime),因为文件可能被备份恢复导致 mtime 不准
 * 采用懒清理策略: 每 ROTATE_CHECK_INTERVAL 次写入且距上次检查 >1 小时才触发
 * L-7 修复: 使用 in-flight Promise 防止并发调用同时执行轮转
 */
async function rotateLogsIfNeeded(): Promise<void> {
  const now = Date.now()
  // 最少间隔 1 小时
  if (now - lastRotateCheck < 3_600_000) return
  // L-7 修复: 如果已有轮转在进行中,复用该 Promise(不重复执行)
  if (rotateInFlight) return rotateInFlight
  lastRotateCheck = now
  rotateInFlight = doRotateLogs().finally(() => {
    rotateInFlight = null
  })
  return rotateInFlight
}

/** L-7 修复: 实际执行轮转的内部方法 */
async function doRotateLogs(): Promise<void> {
  try {
    const files = await fsp.readdir(logsDir)
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 3_600_000)
    for (const f of files) {
      if (!f.endsWith('.log')) continue
      // 从文件名提取日期: main-2026-01-15.log → 2026-01-15
      const m = f.match(/^\w+-(\d{4}-\d{2}-\d{2})\.log$/)
      if (!m) continue
      const fileDate = new Date(m[1])
      if (Number.isNaN(fileDate.getTime())) continue
      if (fileDate < cutoff) {
        try {
          await fsp.unlink(path.join(logsDir, f))
          console.log(`[Logger] Rotated out old log file: ${f}`)
        } catch {
          /* 删除失败不阻塞 */
        }
      }
    }
  } catch {
    /* 轮转失败不阻塞主流程 */
  }
}

async function writeLine(stream: 'main' | 'chat' | 'renderer', line: string): Promise<void> {
  try {
    ensureDir()
    const file = path.join(logsDir, `${stream}-${todayStr()}.log`)
    await fsp.appendFile(file, `${line}\n`, 'utf-8')
    // H-8 修复: 每 ROTATE_CHECK_INTERVAL 次写入触发一次轮转检查
    writeCounter++
    if (writeCounter >= ROTATE_CHECK_INTERVAL) {
      writeCounter = 0
      void rotateLogsIfNeeded()
    }
  } catch {
    /* swallow file errors to keep app running */
  }
}

function fmt(level: LogLevel, scope: string, msg: string): string {
  const t = new Date().toISOString()
  return `${t} [${level.toUpperCase()}] [${scope}] ${msg}`
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** 初始化 — 从 settings.logLevel 读取 + 劫持 console */
// 避免重复 initLogger 时层层包裹(double-wrap)导致每条日志被重复写入多次。
// 实现: 给我们的 wrapper 打标签(固定字符串 key,跨模块重载可识别)并保存原始引用,
// 再次 initLogger 时先取回原始(未包裹)的 console 方法再重新包裹,保证始终只有一层。
const LOGGER_ORIG_KEY = '__loggerOrigFn'
type TaggedFn = ((...args: unknown[]) => void) & {
  [LOGGER_ORIG_KEY]?: (...args: unknown[]) => void
}

function getBuiltin(fn: (...args: unknown[]) => void): (...args: unknown[]) => void {
  const tagged = fn as TaggedFn
  // 如果已被我们包裹,取回它委托的原始函数
  return tagged[LOGGER_ORIG_KEY] ?? fn.bind(console)
}

export function initLogger(level: LogLevel, dir?: string): void {
  currentLevel = level
  if (dir) logsDir = dir
  ensureDir()
  // DIAGNOSTIC: synchronous write to verify file system access
  try {
    fs.writeFileSync(
      path.join(logsDir, 'init-diagnostic.log'),
      `[${new Date().toISOString()}] initLogger called, level=${level}, logsDir=${logsDir}\n`,
      { flag: 'a' },
    )
  } catch {
    // If this fails, we need to know
  }
  // Suppress EPIPE errors on stdout/stderr. When running as a subprocess with a
  // broken pipe, writes to stdout emit async 'error' events that become uncaught
  // exceptions. Adding a no-op 'error' listener prevents this.
  try {
    process.stdout?.on?.('error', () => {})
  } catch {
    /* ignore */
  }
  try {
    process.stderr?.on?.('error', () => {})
  } catch {
    /* ignore */
  }
  // Bug fix: console.log is a separate function reference from console.info in Node.js.
  // Previously only console.info/warn/error/debug were wrapped, so all console.log calls
  // throughout the codebase bypassed the file logger entirely. Now wrap console.log too.
  const origLog = getBuiltin(console.log as (...args: unknown[]) => void)
  const origDebug = getBuiltin(console.debug as (...args: unknown[]) => void)
  const origInfo = getBuiltin(console.info as (...args: unknown[]) => void)
  const origWarn = getBuiltin(console.warn as (...args: unknown[]) => void)
  const origError = getBuiltin(console.error as (...args: unknown[]) => void)

  const wrap = (
    orig: (...args: unknown[]) => void,
    lvl: LogLevel,
  ): ((...args: unknown[]) => void) => {
    const wrapper: (...args: unknown[]) => void = (...args: unknown[]) => {
      // Write to file FIRST, then call orig (stdout). If stdout pipe is broken
      // (EPIPE when running as a subprocess), orig() throws and the file write
      // would be skipped. By writing to file first, logs are always persisted.
      // orig() is wrapped in try-catch to prevent uncaught EPIPE exceptions.
      if (shouldLog(lvl)) void writeLine('main', fmt(lvl, 'console', args.map(stringify).join(' ')))
      try {
        orig(...args)
      } catch {
        /* EPIPE or other stdout errors — file write already happened */
      }
    }
    ;(wrapper as TaggedFn)[LOGGER_ORIG_KEY] = orig
    return wrapper
  }

  console.log = wrap(origLog, 'info')
  console.debug = wrap(origDebug, 'debug')
  console.info = wrap(origInfo, 'info')
  console.warn = wrap(origWarn, 'warn')
  console.error = wrap(origError, 'error')
}

/** 运行时切换 level */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

export function getLogsDir(): string {
  return logsDir
}

/** 写一条 main 日志 */
export function log(level: LogLevel, scope: string, msg: string): void {
  if (!shouldLog(level)) return
  void writeLine('main', fmt(level, scope, msg))
}

/** 写 chat 流事件(独立文件) */
export function logChat(direction: 'in' | 'out' | 'event', payload: unknown): void {
  if (currentLevel === 'off') return
  void writeLine('chat', fmt('info', `chat-${direction}`, stringify(payload)))
}

/** 写渲染进程转发过来的日志 */
export function logRenderer(level: LogLevel, msg: string): void {
  if (!shouldLog(level)) return
  void writeLine('renderer', fmt(level, 'renderer', msg))
}

/** 列日志文件 */
export async function listLogFiles(): Promise<
  Array<{ stream: string; date: string; name: string; sizeBytes: number }>
> {
  try {
    ensureDir()
    const files = await fsp.readdir(logsDir)
    return files
      .filter((f) => f.endsWith('.log'))
      .map((name) => {
        const m = name.match(/^(main|chat|renderer)-(\d{4}-\d{2}-\d{2})\.log$/)
        return m ? { stream: m[1], date: m[2], name, sizeBytes: 0 } : null
      })
      .filter(
        (x): x is { stream: string; date: string; name: string; sizeBytes: number } => x !== null,
      )
      .map((x) => ({ ...x, sizeBytes: safeSize(path.join(logsDir, x.name)) }))
      .sort((a, b) => b.date.localeCompare(a.date))
  } catch {
    return []
  }
}

function safeSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

/** 读文件 tail */
export async function readLogTail(name: string, lines = 100): Promise<string> {
  try {
    // Use path.resolve + path.relative for the path-traversal check
    // rather than `file.startsWith(logsDir)`. The startsWith check is
    // fragile on macOS where /var/folders/.../T/ is a symlink to
    // /private/var/folders/.../T/: the write goes through one path
    // and the read through another, and they don't string-compare
    // equal even though they refer to the same directory.
    const file = path.resolve(logsDir, name)
    const rel = path.relative(logsDir, file)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return ''
    const content = await fsp.readFile(file, 'utf-8')
    const all = content.split('\n')
    return all.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/** T3: 按 level 过滤读 tail(levels = ['debug','info','warn','error'],空数组 = 不过滤) */
export async function readLogTailByLevel(
  name: string,
  levels: string[],
  lines = 200,
): Promise<string> {
  if (levels.length === 0) return readLogTail(name, lines)
  const tail = await readLogTail(name, 1000) // 读更多再过滤
  return tail
    .split('\n')
    .filter((l) => levels.some((lv) => l.toUpperCase().includes(`[${lv.toUpperCase()}]`)))
    .slice(-lines)
    .join('\n')
}

/** T3: 文本搜索(子串匹配,大小写不敏感) */
export async function searchLog(name: string, query: string, lines = 200): Promise<string> {
  if (!query.trim()) return readLogTail(name, lines)
  const tail = await readLogTail(name, 2000)
  const q = query.toLowerCase()
  return tail
    .split('\n')
    .filter((l) => l.toLowerCase().includes(q))
    .slice(-lines)
    .join('\n')
}

/** T3: 导出日志到指定路径(返回写出字节数)
 *  H-3 修复: 对 targetPath 做安全约束,防止渲染进程被攻破后覆盖任意系统文件 */
export async function exportLog(name: string, targetPath: string): Promise<number> {
  try {
    // See readLogTail for why we use path.relative rather than startsWith.
    const file = path.resolve(logsDir, name)
    const rel = path.relative(logsDir, file)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return 0
    // H-3: targetPath 安全校验
    if (typeof targetPath !== 'string' || targetPath.length === 0) return 0
    if (targetPath.includes('\0')) return 0
    // 拒绝路径中包含 .. 段(路径穿越)
    const targetSegments = targetPath.split(/[\\/]/)
    if (targetSegments.includes('..')) return 0
    // 必须是绝对路径(防止相对路径写到意外位置)
    if (!path.isAbsolute(targetPath)) return 0
    // 拒绝写入到系统关键目录(防止覆盖系统文件)
    const sysBlockedPrefixes = getSystemBlockedPrefixes()
    const normalizedTarget = path.normalize(targetPath)
    for (const blocked of sysBlockedPrefixes) {
      if (
        normalizedTarget === blocked ||
        normalizedTarget.startsWith(blocked + path.sep) ||
        normalizedTarget.startsWith(`${blocked}/`)
      ) {
        return 0
      }
    }
    const content = await fsp.readFile(file, 'utf-8')
    await fsp.writeFile(targetPath, content, 'utf-8')
    return Buffer.byteLength(content, 'utf-8')
  } catch {
    return 0
  }
}

/** H-3: 返回系统关键目录列表(导出到这些路径会破坏系统) */
function getSystemBlockedPrefixes(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const prefixes: string[] = []
  if (process.platform === 'win32') {
    prefixes.push('C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData')
    if (home) {
      prefixes.push(
        path.join(
          home,
          'AppData',
          'Roaming',
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          'Startup',
        ),
      )
    }
  } else {
    // Unix-like (linux / macOS)
    prefixes.push('/etc', '/usr', '/bin', '/sbin', '/boot', '/var', '/sys', '/dev', '/proc')
    if (home) {
      prefixes.push(path.join(home, '.ssh'))
    }
  }
  return prefixes
}

/** 清空所有日志 */
export async function clearAllLogs(): Promise<number> {
  try {
    const files = await fsp.readdir(logsDir)
    let n = 0
    for (const f of files) {
      if (f.endsWith('.log')) {
        await fsp.unlink(path.join(logsDir, f))
        n++
      }
    }
    return n
  } catch {
    return 0
  }
}
