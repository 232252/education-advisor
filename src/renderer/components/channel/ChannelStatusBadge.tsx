// =============================================================
// ChannelStatusBadge — 频道五态状态徽标(连接中心面板/设置页共用)
// 五态: not-configured / disabled / connecting / connected / error
// (+ degraded 降级子态标注);两种形态:
//   plain = 点 + 彩色文字(设置页卡片头)
//   pill  = 点 + 文字 + 语义色底胶囊(连接中心面板行 / 卡片升级态)
// 辉光手法对齐 AgentStatusBar 运行点(glow + pulse)。
// =============================================================

import type { ChannelRunStatus } from '@shared/types'
import { useT } from '../../i18n'
import { cn } from '../../lib/ui-utils'

interface ChannelStatusBadgeProps {
  status: ChannelRunStatus
  degraded?: boolean
  detail?: string
  variant?: 'plain' | 'pill'
}

const DOT_CLASS: Record<ChannelRunStatus, string> = {
  'not-configured': 'bg-gray-400 dark:bg-gray-600',
  disabled: 'bg-gray-400 dark:bg-gray-600',
  connecting: 'bg-amber-400 animate-pulse',
  connected: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse',
  error: 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]',
}

const TEXT_CLASS: Record<ChannelRunStatus, string> = {
  'not-configured': 'text-gray-500 dark:text-gray-400',
  disabled: 'text-gray-500 dark:text-gray-400',
  connecting: 'text-amber-600 dark:text-amber-400',
  connected: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
}

const PILL_CLASS: Partial<Record<ChannelRunStatus, string>> = {
  'not-configured':
    'bg-gray-100 dark:bg-white/[0.05] ring-1 ring-gray-300/40 dark:ring-white/[0.07]',
  disabled: 'bg-gray-100 dark:bg-white/[0.05] ring-1 ring-gray-300/40 dark:ring-white/[0.07]',
  connecting:
    'bg-amber-500/10 dark:bg-amber-500/15 ring-1 ring-amber-500/20 dark:ring-amber-500/25',
  connected:
    'bg-emerald-500/10 dark:bg-emerald-500/15 ring-1 ring-emerald-500/20 dark:ring-emerald-500/25',
  error: 'bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-500/20 dark:ring-red-500/25',
}

/** 状态文案(t 兜底模式;集中一处便于 i18n 键管理) */
export function useChannelStatusText(): (status: ChannelRunStatus) => string {
  const { t } = useT()
  return (status: ChannelRunStatus) => {
    switch (status) {
      case 'connected':
        return t('settings.channels.status.connected', '运行中')
      case 'connecting':
        return t('settings.channels.status.connecting', '连接中…')
      case 'error':
        return t('settings.channels.status.error', '错误')
      case 'disabled':
        return t('settings.channels.status.disabled', '已停用')
      default:
        return t('settings.channels.status.notConfigured', '未配置')
    }
  }
}

export function ChannelStatusBadge({
  status,
  degraded,
  detail,
  variant = 'plain',
}: ChannelStatusBadgeProps) {
  const statusText = useChannelStatusText()(status)
  const { t } = useT()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 min-w-0',
        variant === 'pill' &&
          cn('px-2 py-0.5 rounded-full text-[11px] font-medium', PILL_CLASS[status]),
      )}
    >
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', DOT_CLASS[status])} />
      <span
        className={cn(
          variant === 'plain' ? 'text-xs' : 'text-[11px]',
          'truncate',
          TEXT_CLASS[status],
        )}
      >
        {statusText}
        {degraded && (
          <span className="ml-1 text-amber-500 dark:text-amber-400">
            {t('settings.channels.status.degraded', '(流式已降级)')}
          </span>
        )}
        {status === 'error' && detail && (
          <span className="ml-1 text-red-500 dark:text-red-400" title={detail}>
            · {detail.length > 40 ? `${detail.slice(0, 40)}…` : detail}
          </span>
        )}
      </span>
    </span>
  )
}
