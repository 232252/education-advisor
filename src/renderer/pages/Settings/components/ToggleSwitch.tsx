// =============================================================
// ToggleSwitch — 统一开关控件(R2+ 收敛三套手写 toggle)
// md = 11x6(设置页),sm = 9x5(列表行内);checked 统一 blue-600 与 Button 主色一致
// =============================================================

export interface ToggleSwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** 可访问名称:用于屏幕阅读器 announce 此开关控制什么 */
  label?: string
  /** 尺寸:md(默认,设置行)/ sm(紧凑列表行) */
  size?: 'md' | 'sm'
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  size = 'md',
}: ToggleSwitchProps) {
  const track = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6'
  const knobSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  const knobShift = size === 'sm' ? 'translate-x-4' : 'translate-x-5'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative ${track} rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 ${knobSize} bg-white rounded-full shadow-sm transition-transform ${
          checked ? knobShift : 'translate-x-0'
        }`}
      />
    </button>
  )
}
