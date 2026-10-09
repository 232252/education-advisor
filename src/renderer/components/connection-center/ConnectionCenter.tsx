// =============================================================
// ConnectionCenter — 常驻入口按钮 + 懒挂载弹出面板
// 打开的是官方 dsh-im。外点 / Esc 关闭，Alt+C 唤起。
// 入口不再用旧频道适配器的报错点红点：那些频道已经不负责登录。
// =============================================================

import { PlugZap } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { cn } from '../../lib/ui-utils'
import { OPEN_CONNECTION_CENTER } from './open-connection-center'

const ConnectionCenterPanel = lazy(() =>
  import('./ConnectionCenterPanel').then((m) => ({ default: m.ConnectionCenterPanel })),
)

export function ConnectionCenter() {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭 / Esc 关闭(面板 portal 到 body,须同时判定入口与面板)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_CONNECTION_CENTER, onOpen)
    return () => window.removeEventListener(OPEN_CONNECTION_CENTER, onOpen)
  }, [])

  // Alt+C 全局唤起/关闭(不占 Ctrl+C;输入框聚焦时同样生效,与通知中心 Esc 同级)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('connectionCenter.entryAria', '连接中心')}
        title={`${t('connectionCenter.title', '连接中心')} (Alt+C)`}
        aria-expanded={open}
        className={cn(
          'relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
          'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
          'hover:bg-gray-100 dark:hover:bg-white/[0.08]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
          open && 'bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-gray-300',
        )}
      >
        <PlugZap size={16} />
      </button>

      {/* 弹出面板 — portal 到 body,贴侧栏右缘;打开时懒挂载 */}
      {open && (
        <Suspense fallback={null}>
          <ConnectionCenterPanel
            onClose={() => setOpen(false)}
            anchorRef={rootRef}
            panelRef={panelRef}
          />
        </Suspense>
      )}
    </div>
  )
}
