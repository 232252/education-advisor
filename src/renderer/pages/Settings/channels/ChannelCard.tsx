// =============================================================
// ChannelCard — 渠道卡片(连接中心卡片墙的单卡,M5;2026-09-13 视觉升级)
// 内容清单:品牌瓦片/名称/状态 pill/启用开关/关键绑定信息/配置展开;
// 「即将支持」占位卡(manifest.comingSoon)只读展示。
// 品牌瓦片与五态徽标与连接中心面板共用(components/channel)。
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo } from '@shared/types'
import { ChevronDown } from 'lucide-react'
import { useEffect, useReducer } from 'react'
import { ChannelBrandIcon } from '../../../components/channel/ChannelBrandIcon'
import { ChannelStatusBadge } from '../../../components/channel/ChannelStatusBadge'
import { ChannelLimitationBanner } from '../../../components/connection-center/ChannelLimitationBanner'
import { tr, useT } from '../../../i18n'
import { cn, formatDateTime } from '../../../lib/ui-utils'
import { ToggleSwitch } from '../components'

interface ChannelCardProps {
  info: ChannelInstanceInfo
  /** 运行时状态覆写(IPC 状态事件;缺省用 list() 的派生态) */
  liveStatus?: ChannelStatusInfo
  expanded: boolean
  onToggleExpand: () => void
  onSave: (path: string, value: unknown) => void
  /** 展开态内容(配置面板)由父组件渲染,卡片只负责收起态 + 展开容器 */
  children?: React.ReactNode
}

/** 连接时长短格式(§10.6): 刚刚 / N 分钟 / H 小时 M 分 / N 天 */
function formatUptime(ms: number, t: (key: string, fallback: string) => string): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return t('settings.channels.uptime.justNow', '刚刚')
  if (minutes < 60) return tr('settings.channels.uptime.minutes', { n: minutes }, '{n} 分钟')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return tr('settings.channels.uptime.hours', { h: hours, m: minutes % 60 }, '{h} 小时 {m} 分')
  }
  return tr('settings.channels.uptime.days', { n: Math.floor(hours / 24) }, '{n} 天')
}

export function ChannelCard({
  info,
  liveStatus,
  expanded,
  onToggleExpand,
  onSave,
  children,
}: ChannelCardProps) {
  const { t } = useT()
  const status = liveStatus ?? info.status
  const comingSoon = info.manifest.comingSoon === true

  // 已连接时长随时间自增(60s 重算;§10.6)
  const [, tickUptime] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const id = window.setInterval(tickUptime, 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'group p-4 flex flex-col gap-2.5 rounded-xl transition-all duration-200',
          comingSoon
            ? 'border border-dashed border-gray-300 dark:border-white/[0.12] opacity-70'
            : cn(
                'border shadow-sm',
                'border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-elevated/50',
                // 展开态收起悬浮效果(表单操作时卡片不该晃)
                !expanded &&
                  'hover:shadow-md hover:border-gray-300/80 dark:hover:border-white/[0.12] hover:-translate-y-0.5',
              ),
        )}
      >
        <div className="flex items-center gap-3">
          <ChannelBrandIcon
            channelId={info.manifest.id}
            label={info.manifest.label}
            icon={info.manifest.icon}
            muted={comingSoon}
            className={cn(
              'transition-transform duration-200',
              !expanded && !comingSoon && 'group-hover:scale-105',
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                {info.manifest.label}
              </span>
              {info.manifest.beta && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  {t('settings.channels.beta', 'Beta')}
                </span>
              )}
              {comingSoon && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-500/30">
                  {t('settings.channels.comingSoon', '即将支持')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <ChannelStatusBadge
                status={status.status}
                degraded={status.degraded}
                detail={status.detail}
              />
              {status.status === 'connected' && status.connectedAt != null && (
                <span
                  className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0"
                  title={t('settings.channels.uptime.since', '连接建立于 {time}').replace(
                    '{time}',
                    formatDateTime(status.connectedAt),
                  )}
                >
                  {tr(
                    'settings.channels.uptime',
                    { dur: formatUptime(Date.now() - status.connectedAt, t) },
                    '已运行 {dur}',
                  )}
                </span>
              )}
            </div>
          </div>
          {!comingSoon && (
            <ToggleSwitch
              checked={info.enabled}
              onChange={(v) => onSave(`channels.${info.manifest.id}.enabled`, v)}
              label={t('settings.channels.enable', '启用')}
            />
          )}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
          {info.manifest.description}
        </p>

        {info.manifest.limitationBannerKey && (
          <ChannelLimitationBanner bannerKey={info.manifest.limitationBannerKey} />
        )}

        <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
          {status.status === 'connected' && status.processingCount > 0 && (
            <span className="text-blue-500 dark:text-blue-400">
              {t('settings.channels.processing', '处理中')} {status.processingCount}
            </span>
          )}
          {status.pendingCount > 0 && (
            <span>
              {t('settings.channels.pending', '排队')} {status.pendingCount}
            </span>
          )}
          <div className="flex-1" />
          {!comingSoon && (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
            >
              {expanded
                ? t('settings.channels.collapse', '收起')
                : t('settings.channels.configure', '配置')}
              <ChevronDown
                size={12}
                className={cn('transition-transform duration-200', expanded && 'rotate-180')}
              />
            </button>
          )}
        </div>
      </div>
      {expanded && !comingSoon && (
        <div className="mt-1 border border-gray-200 dark:border-white/[0.08] rounded-xl overflow-hidden bg-gray-50/50 dark:bg-surface-elevated/30 animate-slide-up">
          {children}
        </div>
      )}
    </div>
  )
}
