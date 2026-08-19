// =============================================================
// relative-time — 通知时间相对格式化(纯函数,可单测)
// 使用 time.* i18n key: 刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 本周
// =============================================================

type TFunc = (key: string, fallback?: string) => string

export function formatRelativeTime(timestamp: number, now: number, t: TFunc): string {
  const diff = now - timestamp
  if (diff < 60_000) return t('time.justNow', '刚刚')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('time.minutesAgo', '{0} 分钟前').replace('{0}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', '{0} 小时前').replace('{0}', String(hours))
  const days = Math.floor(hours / 24)
  if (days === 1) return t('time.yesterday', '昨天')
  if (days < 7) return t('time.daysAgo', '{0} 天前').replace('{0}', String(days))
  return t('time.thisWeek', '本周')
}
