// =============================================================
// NumberSettingRow — SettingRow + 数字输入的组合
// 两种模式(与被收敛各处的原行为逐一等价):
//   invalidToast 提供 → parseInt + 范围校验,非法 toast 且不写入
//   未提供           → 直接 Number(value) 写入(ChatSection 原行为)
// =============================================================

import { cn, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { SettingRow } from './SettingRow'

export interface NumberSettingRowProps {
  /** 设置路径(兼作 SettingRow 的 HintIcon 定位) */
  path: string
  label: string
  description?: string
  value: number
  min?: number
  max?: number
  step?: number
  /** 输入框宽度类(默认 w-24) */
  width?: string
  onSave: (path: string, value: unknown) => void
  /** 校验失败提示文案;提供后启用 parseInt+范围校验 */
  invalidToast?: string
  /** 校验时额外放行的哨兵值(如 -1 表示不限时) */
  allowValue?: number
  disabled?: boolean
}

export function NumberSettingRow({
  path,
  label,
  description,
  value,
  min,
  max,
  step,
  width = 'w-24',
  onSave,
  invalidToast,
  allowValue,
  disabled,
}: NumberSettingRowProps) {
  return (
    <SettingRow label={label} path={path} description={description}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          if (invalidToast === undefined) {
            onSave(path, Number(e.target.value))
            return
          }
          const v = Number.parseInt(e.target.value, 10)
          const inRange =
            v === allowValue ||
            (Number.isFinite(v) && min !== undefined && max !== undefined && v >= min && v <= max)
          if (inRange) {
            onSave(path, v)
          } else {
            toast.error(invalidToast)
          }
        }}
        className={cn(INPUT_SM, width)}
        disabled={disabled}
      />
    </SettingRow>
  )
}
