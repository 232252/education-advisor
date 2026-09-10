// =============================================================
// SecretInput — 密钥类输入框(密码框 + 显示/隐藏切换)
// 用于 feishu.appSecret 等敏感字段,默认以 •••••••• 遮蔽
// =============================================================

import { useState } from 'react'
import { useT } from '../../../i18n'
import { cn, INPUT_SM } from '../../../lib/ui-utils'

export interface SecretInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onBlur?: () => void
  inputClassName?: string
}

export function SecretInput({
  value,
  onChange,
  placeholder,
  onBlur,
  inputClassName,
}: SecretInputProps) {
  const { t } = useT()
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        placeholder={placeholder ?? t('common.unset', '未设置')}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn(INPUT_SM, inputClassName ?? 'w-44')}
      />
      {value && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 transition-colors"
        >
          {revealed
            ? t('page.settings.secret.hide', '隐藏')
            : t('page.settings.secret.show', '显示')}
        </button>
      )}
    </div>
  )
}
