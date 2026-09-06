// =============================================================
// utils/err-text — unknown 错误值 → 用户可读消息
// IPC handler catch 块统一使用(全仓 100+ 处同形态提取的单一来源)
// =============================================================

/** 提取错误消息:Error 取 message,其余 String 化 */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
