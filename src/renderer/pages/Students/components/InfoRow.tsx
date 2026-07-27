// =============================================================
// InfoRow — 单行信息展示 (label: value)
// 用于概览卡 / 档案 EAA 元数据等位置,可带高亮样式
// =============================================================

export function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: unknown
  highlight?: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-white/[0.06] last:border-0">
      <span className="text-gray-500 dark:text-gray-400 text-xs">{label}</span>
      <span className={`font-medium text-sm ${highlight ?? ''}`}>{String(value)}</span>
    </div>
  )
}
