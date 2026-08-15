// =============================================================
// 日志文件 transport — 追加写入 / 目录保障 / 清空
//
// 文件: logs/main-YYYY-MM-DD.log + logs/chat-YYYY-MM-DD.log + logs/renderer-YYYY-MM-DD.log
// H-8 修复: 每 ROTATE_CHECK_INTERVAL 次写入触发一次轮转检查(避免每次写入都 readdir)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { todayStr } from './format'
import { rotateLogsIfNeeded } from './rotation'
import { loggerState } from './state'

/** 每隔多少次写入触发一次轮转检查(避免每次写入都 readdir) */
export const ROTATE_CHECK_INTERVAL = 100

/** 日志流类型 */
export type LogStream = 'main' | 'chat' | 'renderer'

export function ensureDir(): void {
  try {
    fs.mkdirSync(loggerState.logsDir, { recursive: true })
  } catch {
    /* ignore */
  }
}

export async function writeLine(stream: LogStream, line: string): Promise<void> {
  try {
    ensureDir()
    const file = path.join(loggerState.logsDir, `${stream}-${todayStr()}.log`)
    await fsp.appendFile(file, `${line}\n`, 'utf-8')
    // H-8 修复: 每 ROTATE_CHECK_INTERVAL 次写入触发一次轮转检查
    loggerState.writeCounter++
    if (loggerState.writeCounter >= ROTATE_CHECK_INTERVAL) {
      loggerState.writeCounter = 0
      void rotateLogsIfNeeded()
    }
  } catch {
    /* swallow file errors to keep app running */
  }
}

/** 清空所有日志 */
export async function clearAllLogs(): Promise<number> {
  try {
    const files = await fsp.readdir(loggerState.logsDir)
    let n = 0
    for (const f of files) {
      if (f.endsWith('.log')) {
        await fsp.unlink(path.join(loggerState.logsDir, f))
        n++
      }
    }
    return n
  } catch {
    return 0
  }
}
