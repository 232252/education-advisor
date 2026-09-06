// =============================================================
// MetricCard — 概览/统计用的小型指标卡片
// 显示单个标签 + 数值,带渐变背景与颜色主题
// =============================================================

import { GRADIENT_TONES, type GradientTone } from '../../../lib/ui-utils'

export function MetricCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  const tone = GRADIENT_TONES[color as GradientTone]
  return (
    <div
      className={`rounded-xl border p-3 bg-gradient-to-br ${tone ? `${tone.bg} ${tone.border} ${tone.text}` : ''} shadow-sm`}
    >
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  )
}
