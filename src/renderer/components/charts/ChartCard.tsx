// =============================================================
// ChartCard — 图表卡片统一容器 (M21)
//
// 收敛 7 个图表组件重复的"Card 包裹 + 标题(圆点/emoji 混用) +
// ReactEChartsCore 渲染 + 空态 EmptyState"样板:
//   - 统一标题样式(text-sm font-semibold + 可选彩色圆点,去掉混用的 emoji)
//   - 统一空态渲染(isEmpty/option 为 null 时显示 EmptyState)
//   - 统一 echarts 注册来源(lib/echarts-setup)与高度控制
// 数据 shaping 与 option 构造仍在各图表组件(语义差异),
// 共享样板走本组件 + charts/option-builders。
// =============================================================

import ReactEChartsCore from 'echarts-for-react/esm/core'
import type { ReactNode } from 'react'
import { echarts } from '../../lib/echarts-setup'
import { Card } from '../Card'
import { EmptyState } from '../EmptyState'

interface ChartCardProps {
  /** 卡片标题(已翻译的文本,由调用方 t() 传入) */
  title: string
  /** 标题左侧圆点颜色(品牌语义色,如 bg-blue-500 对应 '#3b82f6') */
  dotColor?: string
  /** 图表高度 px */
  height?: number
  /** ECharts option;null 或 isEmpty=true 时渲染空态 */
  option: Record<string, unknown> | null
  /** 强制空态(数据未就绪等场景,即使 option 已构造) */
  isEmpty?: boolean
  /** 空态标题(已翻译) */
  emptyTitle?: string
  /** 空态图标 */
  emptyIcon?: ReactNode
  /** 空态额外样式(如与图表等高的 'h-[300px] py-0') */
  emptyClassName?: string
  /** Card padding 变体 */
  padding?: 'sm' | 'md'
  /** Card 额外样式(网格布局跨度等) */
  className?: string
}

export function ChartCard({
  title,
  dotColor,
  height = 260,
  option,
  isEmpty = false,
  emptyTitle,
  emptyIcon,
  emptyClassName,
  padding = 'md',
  className,
}: ChartCardProps) {
  const empty = isEmpty || option == null
  return (
    <Card padding={padding} className={className}>
      <div className="flex items-center gap-2 mb-3">
        {dotColor && (
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
        )}
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h3>
      </div>
      {empty ? (
        <EmptyState icon={emptyIcon} title={emptyTitle ?? ''} className={emptyClassName} />
      ) : (
        <ReactEChartsCore echarts={echarts} style={{ height }} option={option} />
      )}
    </Card>
  )
}
