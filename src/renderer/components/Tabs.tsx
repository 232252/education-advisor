// =============================================================
// Tabs — 数据驱动 Tab 导航栏(StudentProfile/Academics/ClassProfile/
// Skills 四处手写合一;后三页由此获得 Skills 页已有的无障碍与键盘导航)
//
// a11y: role=tablist/tab + aria-selected + roving tabindex +
//       左右方向键切换并移动焦点(WAI-ARIA Tabs 模式)
// =============================================================

import type { LucideIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { cn } from '../lib/ui-utils'

export interface TabItem<K extends string> {
  key: K
  label: string
  icon?: LucideIcon
}

interface TabsProps<K extends string> {
  tabs: ReadonlyArray<TabItem<K>>
  active: K
  onChange: (key: K) => void
  /** tablist 的 aria-label(页面标题) */
  label: string
  /** 按钮 DOM id 前缀(roving tabindex 焦点管理用,页面内唯一即可) */
  idPrefix: string
  /** 关联面板 DOM id(aria-controls,可选) */
  panelId?: string
  /** 尺寸: sm(ClassProfile 紧凑) / md(默认) */
  size?: 'sm' | 'md'
  /** 容器附加类(页面间距/背景差异,如 'px-6' / 'px-4 bg-gray-50/50') */
  className?: string
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
  panelId,
  size = 'md',
  className,
}: TabsProps<K>) {
  const focusTab = (key: K) => {
    document.getElementById(`${idPrefix}-tab-${key}`)?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const idx = tabs.findIndex((tb) => tb.key === active)
    if (idx < 0) return
    const nextIdx =
      e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length
    const nextKey = tabs[nextIdx].key
    onChange(nextKey)
    focusTab(nextKey)
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex flex-shrink-0 border-b border-gray-200 dark:border-white/[0.06]',
        className,
      )}
    >
      {tabs.map((tb) => {
        const Icon = tb.icon
        const selected = active === tb.key
        return (
          <button
            type="button"
            role="tab"
            key={tb.key}
            id={`${idPrefix}-tab-${tb.key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tb.key)}
            className={cn(
              'border-b-2 transition-colors',
              size === 'sm' ? 'px-3 py-2.5 text-xs font-medium' : 'px-4 py-2.5 text-sm',
              selected
                ? 'border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {Icon && <Icon className="mr-1.5 inline-block h-4 w-4 align-[-2px]" aria-hidden />}
            {tb.label}
          </button>
        )
      })}
    </div>
  )
}
