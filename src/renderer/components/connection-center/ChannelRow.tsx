// =============================================================
// ChannelRow — 连接中心面板的单频道行(品牌瓦片 + 五态 pill + 主动作)
// 动作矩阵(设计文档 §2.3,与设置页开关单一事实源):
//   not-configured → 去配置(跳设置锚点)
//   disabled       → 连接  = settings:set(channels.<id>.enabled, true)  保存即重连
//   connecting/connected → 断开 = settings:set(channels.<id>.enabled, false) 保存即停止
//   error          → 重试  = channels.start(id) 直调
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo } from '@shared/types'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { ChannelBrandIcon } from '../channel/ChannelBrandIcon'
import { ChannelStatusBadge } from '../channel/ChannelStatusBadge'

interface ChannelRowProps {
  info: ChannelInstanceInfo
  /** 运行时状态覆写(IPC 状态事件;缺省用 list() 的派生态) */
  liveStatus?: ChannelStatusInfo
  /** 「去配置」由面板处理(关面板 + 导航设置锚点) */
  onConfigure: (channelId: string) => void
}

/** 行内小动作按钮(面板专用;蓝=连接语义,灰=断开/跳转语义) */
function RowAction({
  kind,
  label,
  onClick,
  pending,
  children,
}: {
  kind: 'connect' | 'neutral'
  label: string
  onClick: () => void
  pending?: boolean
  /** 动作后缀图标(如「去配置 →」) */
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors flex-shrink-0',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        kind === 'connect'
          ? 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
          : 'border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
      )}
    >
      {label}
      {children}
    </button>
  )
}

export function ChannelRow({ info, liveStatus, onConfigure }: ChannelRowProps) {
  const { t } = useT()
  const [pending, setPending] = useState(false)
  const status = liveStatus ?? info.status
  const id = info.manifest.id
  const comingSoon = info.manifest.comingSoon === true

  /** 连接/断开共用:写 enabled 开关,主进程「保存即重连」联动启停 */
  const setEnabled = async (value: boolean) => {
    setPending(true)
    try {
      const r = await getAPI().settings.set(`channels.${id}.enabled`, value)
      if (!r?.success) toast.error(r?.error || t('settings.save.failed', '保存失败'))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setPending(false)
    }
  }

  const retry = async () => {
    setPending(true)
    try {
      const r = await getAPI().channels.start(id)
      if (!r.success) toast.error(r.error || t('settings.save.failed', '操作失败'))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setPending(false)
    }
  }

  const renderAction = () => {
    if (comingSoon) return null
    switch (status.status) {
      case 'not-configured':
        return (
          <RowAction
            kind="connect"
            label={t('connectionCenter.action.configure', '去配置')}
            onClick={() => onConfigure(id)}
          >
            <ArrowRight size={11} />
          </RowAction>
        )
      case 'disabled':
        return (
          <RowAction
            kind="connect"
            label={t('connectionCenter.action.connect', '连接')}
            pending={pending}
            onClick={() => void setEnabled(true)}
          />
        )
      case 'connecting':
      case 'connected':
        return (
          <RowAction
            kind="neutral"
            label={t('connectionCenter.action.disconnect', '断开')}
            pending={pending}
            onClick={() => void setEnabled(false)}
          />
        )
      case 'error':
        return (
          <RowAction
            kind="connect"
            label={t('connectionCenter.action.retry', '重试')}
            pending={pending}
            onClick={() => void retry()}
          />
        )
    }
  }

  return (
    <div
      className={cn(
        'px-3 py-2.5 flex items-center gap-2.5 transition-colors',
        !comingSoon && 'hover:bg-white dark:hover:bg-white/[0.04]',
        comingSoon && 'opacity-60',
      )}
    >
      <ChannelBrandIcon
        channelId={id}
        label={info.manifest.label}
        icon={info.manifest.icon}
        size="sm"
        muted={comingSoon}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate">
            {info.manifest.label}
          </span>
          {info.manifest.beta && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex-shrink-0">
              {t('settings.channels.beta', 'Beta')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <ChannelStatusBadge
            status={status.status}
            degraded={status.degraded}
            detail={status.detail}
            variant="pill"
          />
          {info.manifest.limitationBannerKey && status.status === 'not-configured' && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
              {t('connectionCenter.limitationHint', '有能力限制')}
            </span>
          )}
                    {status.status === 'connected' && status.processingCount > 0 && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 flex-shrink-0">
              {t('settings.channels.processing', '处理中')} {status.processingCount}
            </span>
          )}
          {status.pendingCount > 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
              {t('settings.channels.pending', '排队')} {status.pendingCount}
            </span>
          )}
        </div>
        {(status.lastMessageAt || status.detail || (status.reconnectAttempt ?? 0) > 0) && (
          <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500 truncate" title={status.detail || undefined}>
            {status.lastMessageAt
              ? t('connectionCenter.diag.lastMsg', '最近消息') +
                ' ' +
                new Date(status.lastMessageAt).toLocaleString()
              : null}
            {(status.reconnectAttempt ?? 0) > 0
              ? (status.lastMessageAt ? ' · ' : '') +
                t('connectionCenter.diag.reconnect', '重连') +
                ' #' +
                status.reconnectAttempt
              : null}
            {status.status === 'error' && status.detail
              ? (status.lastMessageAt || (status.reconnectAttempt ?? 0) > 0 ? ' · ' : '') + status.detail
              : null}
          </div>
        )}
      </div>
      {renderAction()}
    </div>
  )
}

