// =============================================================
// ClassFilterSelect — 班级筛选下拉(Students/Academics/Dashboard 共用)
// 选项: 全部班级 / 未分班 / 各班级;哨兵值来自 lib/class-filter
// =============================================================

import { CLASS_FILTER_ALL, CLASS_FILTER_NONE } from '../lib/class-filter'
import { cn, INPUT_BASE } from '../lib/ui-utils'

interface ClassFilterSelectProps {
  value: string
  onChange: (v: string) => void
  classes: Array<{ class_id: string; name: string }>
  allLabel: string
  noneLabel: string
  /** 选项显示 "name (class_id)"(Students 工具栏惯例) */
  showIdInLabel?: boolean
  /** 完整 className(默认 INPUT_BASE;可传自定义样式保持页面视觉) */
  className?: string
  title?: string
}

export function ClassFilterSelect({
  value,
  onChange,
  classes,
  allLabel,
  noneLabel,
  showIdInLabel,
  className,
  title,
}: ClassFilterSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(className ?? INPUT_BASE)}
      title={title}
    >
      <option value={CLASS_FILTER_ALL}>{allLabel}</option>
      <option value={CLASS_FILTER_NONE}>{noneLabel}</option>
      {classes.map((c) => (
        <option key={c.class_id} value={c.class_id}>
          {showIdInLabel ? `${c.name} (${c.class_id})` : c.name}
        </option>
      ))}
    </select>
  )
}
