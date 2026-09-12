// =============================================================
// ChannelStatusDot — 频道五态状态点 + 文案(M5 连接中心)
// 五态: not-configured / disabled / connecting / connected / error
// (+ degraded 降级子态角标);enabled 开关与运行状态正交,由卡片呈现
// =============================================================

import type { ChannelRunStatus } from '@shared/types'
import { useT } from '../../../i18n'

interface ChannelStatusDotProps {
  status: ChannelRunStatus
  degraded?: boolean
  detail?: string
}

const DOT_CLASS: Record<ChannelRunStatus, string> = {
  'not-configured': 'bg-gray-400 dark:bg-gray-600',
  disabled: 'bg-gray-400 dark:bg-gray-600',
  connecting: 'bg-amber-400 animate-pulse',
  connected: 'bg-emerald-400 animate-pulse',
  error: 'bg-red-400',
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

export function ChannelStatusDot({ status, degraded, detail }: ChannelStatusDotProps) {
  const statusText = useChannelStatusText()(status)
  const { t } = useT()
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT_CLASS[status]}`} />
      <span className="text-xs text-gray-600 dark:text-gray-300 truncate">
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
