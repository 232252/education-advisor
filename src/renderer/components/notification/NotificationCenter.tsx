// =============================================================
// NotificationCenter — 常驻铃铛 + 懒挂载弹出面板
// 铃铛(未读徽标)始终可见;面板(~150 行+图标映射+相对时间)仅在
// 打开时经 React.lazy 挂载,entry 减负。状态在 notificationStore,
// 两侧各自订阅,无 props 透传。
// =============================================================

import { Bell } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { cn } from '../../lib/ui-utils'
import { selectUnreadCount, useNotificationStore } from '../../stores/notificationStore'

const NotificationPanel = lazy(() =>
  import('./NotificationPanel').then((m) => ({ default: m.NotificationPanel })),
)

export function NotificationCenter() {
  const { t } = useT()
  const unread = useNotificationStore(selectUnreadCount)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭 / Esc 关闭
  // 面板经 portal 挂到 body,必须同时判断铃铛容器与面板本身
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

  return (
    <div ref={rootRef} className="relative">
      {/* 铃铛按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notification.title', '通知中心')}
        title={t('notification.title', '通知中心')}
        className={cn(
          'relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
          'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
          'hover:bg-gray-100 dark:hover:bg-white/[0.08]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        )}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* 弹出面板 — portal 到 body,贴侧栏右缘;打开时懒挂载 */}
      {open && (
        <Suspense fallback={null}>
          <NotificationPanel
            onClose={() => setOpen(false)}
            anchorRef={rootRef}
            panelRef={panelRef}
          />
        </Suspense>
      )}
    </div>
  )
}
