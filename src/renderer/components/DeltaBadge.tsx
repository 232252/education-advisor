// =============================================================
// DeltaBadge — 变化量徽章(↑3 / ↓5 / —)
// 用于考试对比中的分数/名次/操行分变化展示。
// type='score':正=进步(绿↑),负=退步(红↓)
// type='rank': 名次数值变小=上升(绿↑),变大=下降(红↓)——与 score 符号相反
// =============================================================

import { cn, deltaColor, rankDeltaColor } from '../lib/ui-utils'

interface DeltaBadgeProps {
  /** 变化量;null 表示数据缺失(显示"—") */
  delta: number | null
  /** 'score' 分数/操行分(正=好) | 'rank' 名次(数值小=好) */
  type?: 'score' | 'rank'
  /** 是否显示正号(+3 而非 3);默认 true */
  showSign?: boolean
  /** 后缀文字(如 "分" "名");默认空 */
  suffix?: string
  /** 额外样式 */
  className?: string
}

export function DeltaBadge({
  delta,
  type = 'score',
  showSign = true,
  suffix = '',
  className,
}: DeltaBadgeProps) {
  // 数据缺失:显示灰色"—"
  if (delta === null || delta === undefined) {
    return (
      <span className={cn('inline-flex items-center text-xs font-medium text-gray-400', className)}>
        —
      </span>
    )
  }

  // 持平:灰色"—"
  if (delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 dark:text-gray-400',
          className,
        )}
      >
        —{suffix && <span className="ml-0.5">{suffix}</span>}
      </span>
    )
  }

  const colorFn = type === 'rank' ? rankDeltaColor : deltaColor
  // 箭头方向:score 正=↑,rank 负=↑(数值变小=上升)
  // 统一:对 score,正=↑;对 rank,delta<0=↑
  const isUp = type === 'rank' ? delta < 0 : delta > 0
  const arrow = isUp ? '↑' : '↓'
  const sign = delta > 0 && showSign ? '+' : ''
  const absValue = Math.abs(delta)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        colorFn(delta),
        className,
      )}
    >
      <span>{arrow}</span>
      <span>
        {sign}
        {absValue}
      </span>
      {suffix && <span className="ml-0.5">{suffix}</span>}
    </span>
  )
}
