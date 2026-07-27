// =============================================================
// MetricCard — 概览/统计用的小型指标卡片
// 显示单个标签 + 数值,带渐变背景与颜色主题
// =============================================================

export function MetricCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  const g: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 border-blue-500/20 text-blue-600 dark:text-blue-400',
    green:
      'from-green-500/10 to-green-600/5 border-green-500/20 text-green-600 dark:text-green-400',
    red: 'from-red-500/10 to-red-600/5 border-red-500/20 text-red-600 dark:text-red-400',
    yellow:
      'from-yellow-500/10 to-yellow-600/5 border-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  }
  return (
    <div className={`rounded-xl border p-3 bg-gradient-to-br ${g[color] ?? ''} shadow-sm`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  )
}
