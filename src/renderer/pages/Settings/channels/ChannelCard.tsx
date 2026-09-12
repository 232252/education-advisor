// =============================================================
// ChannelCard — 渠道卡片(连接中心卡片墙的单卡,M5)
// 内容清单(竞品蒸馏 P2):图标/名称/状态点/启用开关/关键绑定信息/
// 配置展开;「即将支持」占位卡(manifest.comingSoon)只读展示。
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo } from '@shared/types'
import { useT } from '../../../i18n'
import { ToggleSwitch } from '../components'
import { ChannelStatusDot } from './ChannelStatusDot'

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

/** 渠道图标占位(manifest.icon → 简单字母徽标;正式图标随渠道接入补) */
function ChannelIcon({ icon, label }: { icon: string; label: string }) {
  return (
    <span
      aria-hidden
      className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold select-none"
    >
      {label.slice(0, 1) || icon.slice(0, 1).toUpperCase()}
    </span>
  )
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

  return (
    <div className="flex flex-col">
      <div
        className={`p-4 flex flex-col gap-2.5 ${
          comingSoon
            ? 'border border-dashed border-gray-300 dark:border-white/[0.12] rounded-xl opacity-70'
            : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <ChannelIcon icon={info.manifest.icon} label={info.manifest.label} />
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
            <ChannelStatusDot
              status={status.status}
              degraded={status.degraded}
              detail={status.detail}
            />
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
              className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
            >
              {expanded
                ? t('settings.channels.collapse', '收起')
                : t('settings.channels.configure', '配置')}
              <span className="ml-1">{expanded ? '▴' : '▾'}</span>
            </button>
          )}
        </div>
      </div>
      {expanded && !comingSoon && (
        <div className="mt-1 border border-gray-200 dark:border-white/[0.08] rounded-xl overflow-hidden bg-gray-50/50 dark:bg-surface-elevated/30">
          {children}
        </div>
      )}
    </div>
  )
}
