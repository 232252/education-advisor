// =============================================================
// Section — 设置页分区容器(可折叠 + 锚点揭示)
// 标题栏可点击展开/收起,默认收起,避免一屏字段过多。
// 锚点揭示: 传 id 后,URL hash 命中 `#<id>` 时自动展开并滚动定位
// (连接中心面板等入口经 navigate('/settings#connection') 深链到此);
// 经 useLocation 监听,路由切换(pushState 不触发 hashchange)也能命中。
// 其余未传 id 的 Section 行为零变化。
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useT } from '../../../i18n'
import { CARD_BASE } from '../../../lib/ui-utils'

export interface SectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  /** 锚点 id: URL hash 为 #<id> 时自动展开 + 滚动定位 */
  id?: string
}

export function Section({ title, children, defaultOpen = false, id }: SectionProps) {
  const { t } = useT()
  const [open, setOpen] = useState(defaultOpen)
  const containerRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    if (!id || location.hash !== `#${id}`) return
    setOpen(true)
    // 等展开内容渲染出高度后再滚动(双 rAF + 兜底 timeout)
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }),
    )
    const timer = window.setTimeout(() => {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [id, location.hash])

  return (
    <div ref={containerRef} id={id} className={`${CARD_BASE} overflow-hidden scroll-mt-3`}>
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
