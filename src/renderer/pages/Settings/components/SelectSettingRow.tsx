// =============================================================
// SelectSettingRow — SettingRow + <select> 的数据驱动组合
// 收敛各 Section 手写的 select 行(theme/language/timezone/
// closeBehavior/logLevel/steeringMode/backup 间隔等 10+ 处)
// =============================================================

import { cn, INPUT_SM } from '../../../lib/ui-utils'
import { SettingRow } from './SettingRow'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectSettingRowProps {
  /** 设置路径(兼作 SettingRow 的 HintIcon 定位) */
  path: string
  label: string
  description?: string
  value: string
  options: readonly SelectOption[]
  onSave: (path: string, value: unknown) => void
  /** 值写入后的副作用(如 theme-changed 事件 / setLang) */
  onCommit?: (v: string) => void
  /** 数值型设置(如 backup.intervalHours): 写入时转 Number */
  numeric?: boolean
  /** 附加 className(如 'w-48') */
  className?: string
  disabled?: boolean
}

export function SelectSettingRow({
  path,
  label,
  description,
  value,
  options,
  onSave,
  onCommit,
  numeric,
  className,
  disabled,
}: SelectSettingRowProps) {
  return (
    <SettingRow label={label} path={path} description={description}>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onSave(path, numeric ? Number(v) : v)
          onCommit?.(v)
        }}
        className={cn(INPUT_SM, className)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  )
}
