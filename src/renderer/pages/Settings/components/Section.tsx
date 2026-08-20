// =============================================================
// Section — 设置页分区容器(可折叠)
// 标题栏可点击展开/收起,默认展开
// =============================================================

import { useState } from 'react'
import { useT } from '../../../i18n'
import { CARD_BASE } from '../../../lib/ui-utils'

export interface SectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function Section({ title, children, defaultOpen = true }: SectionProps) {
  const { t } = useT()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`${CARD_BASE} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3.5 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-surface-elevated/40 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
      >
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          role="img"
          aria-label={t('page.settings.section.iconAria', '图标')}
        >
          <title>{t('page.settings.section.iconAria', '图标')}</title>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="divide-y divide-gray-200 dark:divide-gray-700/60">{children}</div>}
    </div>
  )
}
