// =============================================================
// 聊天持久化反馈 — saveMessage 失败的用户可见告警(节流)
// =============================================================

import { toast } from '../toastStore'

/** HIGH 1.4 修复: saveMessage 失败时给用户可见反馈(节流,避免连续失败刷屏)
 *  之前只有 console.warn,用户完全无感知,刷新后才发现消息丢失 */
let lastSaveWarnTs = 0
const SAVE_WARN_THROTTLE_MS = 10_000
export function warnSaveFailed(context: string, err: unknown): void {
  console.warn(`[chatStore] saveMessage failed (${context})`, err)
  const now = Date.now()
  if (now - lastSaveWarnTs >= SAVE_WARN_THROTTLE_MS) {
    lastSaveWarnTs = now
    toast.warning('消息保存失败,可能影响历史记录,请查看日志', 6000)
  }
}
