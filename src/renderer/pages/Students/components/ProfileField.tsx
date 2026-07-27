// =============================================================
// ProfileField — 档案选项卡中的单字段 (label + input/textarea/select)
// 支持编辑/只读模式、多行文本、下拉选择、跨列等
// =============================================================

export function ProfileField({
  label,
  value,
  editing,
  type,
  options,
  onChange,
  multiline,
  spanFull,
}: {
  label: string
  value: string
  editing: boolean
  type?: string
  options?: string[]
  onChange?: (v: string) => void
  multiline?: boolean
  spanFull?: boolean
}) {
  const baseClass =
    'w-full bg-gray-50 dark:bg-[#0f1117] border border-gray-300 dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-colors'
  return (
    <div className={spanFull ? 'col-span-2' : ''}>
      {label && (
        <div className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">{label}</div>
      )}
      {editing ? (
        multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={baseClass + (label ? ' mt-1' : '')}
            rows={3}
          />
        ) : type === 'select' && options ? (
          <select
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={baseClass + (label ? ' mt-1' : '')}
          >
            <option value="">未选择</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type ?? 'text'}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={baseClass + (label ? ' mt-1' : '')}
          />
        )
      ) : (
        <div
          className={`${label ? 'mt-1 ' : ''}text-sm font-medium text-gray-700 dark:text-gray-200`}
        >
          {value || '-'}
        </div>
      )}
    </div>
  )
}
