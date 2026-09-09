// =============================================================
// 慢源数据未就绪时的卡片级骨架占位（渐进渲染配套）
// =============================================================

export function DashboardCardSkeleton() {
  return (
    <div className="h-48 rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-surface-tertiary/70 animate-pulse" />
  )
}
