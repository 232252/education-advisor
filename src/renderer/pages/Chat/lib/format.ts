// =============================================================
// Chat 模块格式化工具 — 时间/数字展示纯函数
// =============================================================

/** 格式化消息时间：今天显示 HH:mm，非今天显示 月/日 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** 数字缩写：>=1000 显示 K 单位（如 8K / 12.5K） */
export function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `${n}`
}
