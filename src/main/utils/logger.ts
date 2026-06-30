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
 */
async function rotateLogsIfNeeded(): Promise<void> {
  const now = Date.now()
  // 最少间隔 1 小时
  if (now - lastRotateCheck < 3_600_000) return
  lastRotateCheck = now
  try {
    const files = await fsp.readdir(logsDir)
    const cutoff = new Date(now - LOG_RETENTION_DAYS * 24 * 3_600_000)
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
export function initLogger(level: LogLevel, dir?: string): void {
  currentLevel = level
  if (dir) logsDir = dir
  ensureDir()
  const origDebug = console.debug.bind(console)
  const origInfo = console.info.bind(console)
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)
  console.debug = (...args: unknown[]) => {
    origDebug(...args)
    if (shouldLog('debug'))
      void writeLine('main', fmt('debug', 'console', args.map(stringify).join(' ')))
  }
  console.info = (...args: unknown[]) => {
    origInfo(...args)
    if (shouldLog('info'))
      void writeLine('main', fmt('info', 'console', args.map(stringify).join(' ')))
  }
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    if (shouldLog('warn'))
      void writeLine('main', fmt('warn', 'console', args.map(stringify).join(' ')))
  }
  console.error = (...args: unknown[]) => {
    origError(...args)
    if (shouldLog('error'))
      void writeLine('main', fmt('error', 'console', args.map(stringify).join(' ')))
  }
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

/** T3: 导出日志到指定路径(返回写出字节数) */
export async function exportLog(name: string, targetPath: string): Promise<number> {
  try {
    // See readLogTail for why we use path.relative rather than startsWith.
    const file = path.resolve(logsDir, name)
    const rel = path.relative(logsDir, file)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return 0
    const content = await fsp.readFile(file, 'utf-8')
    await fsp.writeFile(targetPath, content, 'utf-8')
    return Buffer.byteLength(content, 'utf-8')
  } catch {
    return 0
  }
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
