// =============================================================
// NotificationPanel — 通知中心弹出面板(经 NotificationCenter 懒挂载)
// 状态全部来自 notificationStore(与铃铛解耦,挂载即数据就绪);
// 相对时间 60s 刷新 effect 随挂载启停(原 open 门控语义不变)。
// =============================================================

import {
  AlertTriangle,
  Bell,
  Bot,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  Eraser,
  Info,
  type LucideIcon,
  Settings,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tr, useT } from '../../i18n'
import { cn } from '../../lib/ui-utils'
import {
  type NotificationItem,
  type NotificationLevel,
  selectUnreadCount,
  useNotificationStore,
} from '../../stores/notificationStore'
import { formatRelativeTime } from './relative-time'

const LEVEL_ICON: Record<NotificationLevel, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const LEVEL_COLOR: Record<NotificationLevel, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
}

const SOURCE_ICON = {
  agent: Bot,
  cron: CalendarClock,
  system: Settings,
} as const

interface NotificationPanelProps {
  /** 点击带 target 的通知导航后由面板调用(同时关闭面板) */
  onClose: () => void
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const { t } = useT()
  const navigate = useNavigate()
  const notifications = useNotificationStore((s) => s.notifications)
  const unread = useNotificationStore(selectUnreadCount)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const remove = useNotificationStore((s) => s.remove)
  const clear = useNotificationStore((s) => s.clear)

  // 挂载期间每 60s 刷新相对时间显示(面板仅在打开时挂载)
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const handleClick = (n: NotificationItem) => {
    if (!n.read) markRead(n.id)
    if (n.target) {
      onClose()
      navigate(n.target)
    }
  }

  return (
    <div className="absolute left-full bottom-0 ml-2 w-[360px] max-w-[calc(100vw-90px)] bg-white dark:bg-surface-elevated rounded-xl shadow-2xl border border-gray-200/60 dark:border-white/[0.08] overflow-hidden z-[65] animate-scale-in">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-gray-200/70 dark:border-white/[0.07]">
        <Bell size={14} className="text-gray-400 dark:text-gray-500" />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('notification.title', '通知中心')}
        </span>
        {unread > 0 && (
          <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
            {unread} {t('notification.unread', '条未读')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {notifications.length > 0 && (
            <>
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCheck size={12} />
                {t('notification.markAllRead', '全部已读')}
              </button>
              <button
                type="button"
                onClick={clear}
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                <Eraser size={12} />
                {t('notification.clear', '清空')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 通知列表 */}
      <div className="max-h-[420px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="py-12 text-center">
            <Bell size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('notification.empty', '暂无通知')}
            </p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">
              {t('notification.emptyHint', 'Agent 运行结果与定时任务状态会显示在这里')}
            </p>
          </div>
        ) : (
          notifications.map((n) => {
            const LevelIcon = LEVEL_ICON[n.level]
            const SourceIcon = SOURCE_ICON[n.source]
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => handleClick(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleClick(n)
                }}
                className={cn(
                  'group relative flex items-start gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-white/[0.04] cursor-pointer transition-colors',
                  n.read
                    ? 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                    : 'bg-blue-50/40 dark:bg-blue-500/[0.06] hover:bg-blue-50/70 dark:hover:bg-blue-500/[0.1]',
                )}
              >
                <LevelIcon size={15} className={cn('mt-0.5 flex-shrink-0', LEVEL_COLOR[n.level])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-xs font-medium truncate',
                        n.read
                          ? 'text-gray-600 dark:text-gray-400'
                          : 'text-gray-900 dark:text-gray-100',
                      )}
                    >
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </div>
                  {n.message && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 break-all">
                      {n.message}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <SourceIcon size={10} className="text-gray-300 dark:text-gray-600" />
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {formatRelativeTime(n.createdAt, Date.now(), tr)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(n.id)
                  }}
                  aria-label={t('notification.delete', '删除')}
                  className="p-1 rounded text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all flex-shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
