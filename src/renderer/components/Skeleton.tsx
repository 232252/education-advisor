// =============================================================
// Skeleton — 加载骨架屏组件
// 用于替代纯文字 "loading..."，提升加载体验。
// =============================================================

import { cn } from '../lib/ui-utils'

interface SkeletonProps {
  className?: string
}

/** 单行骨架屏 */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06]', className)} />
}

/** 卡片骨架屏 */
export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-[#1a1e28] p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

/** 表格行骨架屏 */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {/* 表头 */}
      <div className="flex gap-4 pb-2 border-b border-gray-200/70 dark:border-white/[0.06]">
        {Array.from({ length: cols }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素，不会重排序
          <Skeleton key={`h-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {/* 行 */}
      {Array.from({ length: rows }).map((_, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素
        <div key={`row-${r}`} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素
            <Skeleton key={`c-${r}-${i}`} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 页面骨架屏（统计卡片 + 图表区域） */
export function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素
          <CardSkeleton key={`stat-${i}`} />
        ))}
      </div>
      {/* 图表区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  )
}
