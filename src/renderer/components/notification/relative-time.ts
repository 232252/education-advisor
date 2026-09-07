// =============================================================
// relative-time — 通知时间相对格式化(纯函数,可单测)
// 使用 time.* i18n key: 刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 本周
// =============================================================

/** 与 i18n 的 tr 同形: (key, 占位符变量, fallback) */
type TrFunc = (key: string, vars: Record<string, string | number>, fallback?: string) => string

export function formatRelativeTime(timestamp: number, now: number, tr: TrFunc): string {
  const diff = now - timestamp
  if (diff < 60_000) return tr('time.justNow', {}, '刚刚')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return tr('time.minutesAgo', { 0: minutes }, '{0} 分钟前')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tr('time.hoursAgo', { 0: hours }, '{0} 小时前')
  const days = Math.floor(hours / 24)
  if (days === 1) return tr('time.yesterday', {}, '昨天')
  if (days < 7) return tr('time.daysAgo', { 0: days }, '{0} 天前')
  return tr('time.thisWeek', {}, '本周')
}
