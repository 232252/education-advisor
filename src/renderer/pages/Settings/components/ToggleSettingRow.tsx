// =============================================================
// ToggleSettingRow — SettingRow + ToggleSwitch 的数据驱动组合
// 收敛各 Section 手写的 toggle 行(compaction/showImages/logging/
// autoStart/tray/autoUpdate/backup×2/mcp/bitableSync 共 10 处)
// =============================================================

import { SettingRow } from './SettingRow'
import { ToggleSwitch } from './ToggleSwitch'

export interface ToggleSettingRowProps {
  /** 设置路径(兼作 SettingRow 的 HintIcon 定位) */
  path: string
  label: string
  description?: string
  value: boolean
  onSave: (path: string, value: unknown) => void
}

export function ToggleSettingRow({
  path,
  label,
  description,
  value,
  onSave,
}: ToggleSettingRowProps) {
  return (
    <SettingRow label={label} path={path} description={description}>
      <ToggleSwitch checked={value} onChange={(v) => onSave(path, v)} label={label} />
    </SettingRow>
  )
}
