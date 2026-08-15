// =============================================================
// 日志查询 — 列文件 / 读 tail / 按级别过滤 / 文本搜索
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ensureDir } from './file-transport'
import { loggerState } from './state'

/** 列日志文件 */
export async function listLogFiles(): Promise<
  Array<{ stream: string; date: string; name: string; sizeBytes: number }>
> {
  try {
    ensureDir()
    const files = await fsp.readdir(loggerState.logsDir)
    return files
      .filter((f) => f.endsWith('.log'))
      .map((name) => {
        const m = name.match(/^(main|chat|renderer)-(\d{4}-\d{2}-\d{2})\.log$/)
        return m ? { stream: m[1], date: m[2], name, sizeBytes: 0 } : null
      })
      .filter(
        (x): x is { stream: string; date: string; name: string; sizeBytes: number } => x !== null,
      )
      .map((x) => ({ ...x, sizeBytes: safeSize(path.join(loggerState.logsDir, x.name)) }))
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
    const file = path.resolve(loggerState.logsDir, name)
    const rel = path.relative(loggerState.logsDir, file)
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
