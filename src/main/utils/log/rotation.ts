// =============================================================
// 日志轮转清理 — 删除超过保留期的旧日志文件
//
// H-8 修复: 日志轮转配置
//   - 通过文件名中的日期判断(而非 mtime),因为文件可能被备份恢复导致 mtime 不准
//   - 采用懒清理策略: 每 ROTATE_CHECK_INTERVAL 次写入且距上次检查 >1 小时才触发
// L-7 修复: 使用 in-flight Promise 防止并发调用同时执行轮转
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { loggerState } from './state'

/** 保留多少天内的日志文件,超过的自动删除 */
const LOG_RETENTION_DAYS = 30

/**
 * H-8 修复: 日志轮转 — 删除超过 LOG_RETENTION_DAYS 天的旧日志文件
 * 通过文件名中的日期判断(而非 mtime),因为文件可能被备份恢复导致 mtime 不准
 * 采用懒清理策略: 每 ROTATE_CHECK_INTERVAL 次写入且距上次检查 >1 小时才触发
 * L-7 修复: 使用 in-flight Promise 防止并发调用同时执行轮转
 */
export async function rotateLogsIfNeeded(): Promise<void> {
  const now = Date.now()
  // 最少间隔 1 小时
  if (now - loggerState.lastRotateCheck < 3_600_000) return
  // L-7 修复: 如果已有轮转在进行中,复用该 Promise(不重复执行)
  if (loggerState.rotateInFlight) return loggerState.rotateInFlight
  loggerState.lastRotateCheck = now
  loggerState.rotateInFlight = doRotateLogs().finally(() => {
    loggerState.rotateInFlight = null
  })
  return loggerState.rotateInFlight
}

/** L-7 修复: 实际执行轮转的内部方法 */
export async function doRotateLogs(): Promise<void> {
  try {
    const files = await fsp.readdir(loggerState.logsDir)
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
          await fsp.unlink(path.join(loggerState.logsDir, f))
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
