// =============================================================
// ConnectionCenterPanel — 连接中心弹出面板(经 ConnectionCenter 懒挂载)
// 结构(设计文档 §2.2): 头部(标题+汇总 pill) / 消息频道行列表 /
// 手机·浏览器接入(WebUiConnectBlock) / 底栏(完整设置 + 快捷键提示)。
// 定位算法与 NotificationPanel 同款(PANEL_WIDTH 提到 400),portal 到
// body + fixed,贴侧栏右缘、底部对齐锚点。
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo } from '@shared/types'
import { PlugZap, Settings, X } from 'lucide-react'
import { type RefObject, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { tr, useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { ChannelRow } from './ChannelRow'
import { WebUiConnectBlock } from './WebUiConnectBlock'

const PANEL_WIDTH = 400
const PANEL_GAP = 8

interface ConnectionCenterPanelProps {
  onClose: () => void
  /** 入口按钮容器,用来计算侧栏右缘与底部对齐 */
  anchorRef: RefObject<HTMLElement | null>
  /** 供入口侧判定「点击是否落在面板内」(portal 后不再是入口的 DOM 子节点) */
  panelRef: RefObject<HTMLDivElement | null>
}

function computePanelPosition(anchor: HTMLElement): { left: number; bottom: number } {
  const entry = anchor.getBoundingClientRect()
  const aside = anchor.closest('aside')
  const sidebarRight = aside?.getBoundingClientRect().right ?? entry.right
  const width = Math.min(PANEL_WIDTH, Math.max(240, window.innerWidth - PANEL_GAP * 2))
  const left = Math.max(
    PANEL_GAP,
    Math.min(sidebarRight + PANEL_GAP, window.innerWidth - width - PANEL_GAP),
  )
  const bottom = Math.max(PANEL_GAP, window.innerHeight - entry.bottom)
  return { left, bottom }
}

export function ConnectionCenterPanel({
  onClose,
  anchorRef,
  panelRef,
}: ConnectionCenterPanelProps) {
  const { t } = useT()
  const navigate = useNavigate()
  const [instances, setInstances] = useState<ChannelInstanceInfo[]>([])
  const [liveStatus, setLiveStatus] = useState<Record<string, ChannelStatusInfo>>({})
  const [pos, setPos] = useState({ left: PANEL_GAP, bottom: PANEL_GAP })

  // 挂载拉取渠道目录 + 订阅状态变化(卸载退订;与设置页各自订阅同一广播,状态天然收敛)
  useEffect(() => {
    let disposed = false
    getAPI()
      .channels.list()
      .then((list) => {
        if (!disposed) setInstances(list)
      })
      .catch((err) => console.warn('[ConnectionCenter] list failed:', err))
    const unsub = getAPI().channels.onStatusUpdate((info) => {
      setLiveStatus((prev) => ({ ...prev, [info.channel]: info }))
    })
    return () => {
      disposed = true
      unsub()
    }
  }, [])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const update = () => setPos(computePanelPosition(anchor))
    update()
    window.addEventListener('resize', update)
    const aside = anchor.closest('aside')
    const ro = aside ? new ResizeObserver(update) : null
    if (aside) ro?.observe(aside)
    return () => {
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
  }, [anchorRef])

  /** 跳设置页锚点:先关面板再导航(Section 按 location.hash 自揭示) */
  const openSettings = (hash: string) => {
    onClose()
    navigate(`/settings${hash}`)
  }

  // 汇总:不计占位渠道;connected 数取实时覆写
  const real = instances.filter((i) => i.manifest.comingSoon !== true)
  const connectedCount = real.filter(
    (i) => (liveStatus[i.manifest.id] ?? i.status).status === 'connected',
  ).length
  const summaryTone =
    real.length > 0 && connectedCount === real.length
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20'
      : connectedCount > 0
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20'
        : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 ring-gray-400/20 dark:ring-white/[0.08]'

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panelRef}
      data-testid="connection-center-panel"
      className="fixed w-[400px] max-w-[calc(100vw-16px)] bg-white dark:bg-surface-elevated rounded-xl shadow-2xl dark:shadow-[0_24px_64px_rgba(0,0,0,0.6)] dark:ring-1 dark:ring-white/[0.07] border border-gray-200/60 dark:border-white/[0.08] overflow-hidden z-[65] animate-slide-in-left flex flex-col max-h-[min(560px,calc(100vh-16px))]"
      style={{ left: pos.left, bottom: pos.bottom }}
    >
      {/* 头部: 品牌瓦片(§10.1,与频道瓦片同语言) + 标题 + 汇总 pill + 关闭 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200/70 dark:border-white/[0.07]">
        <span
          aria-hidden
          className={cn(
            'w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500',
            'ring-1 ring-white/20 shadow-[0_2px_8px_rgba(59,130,246,0.35)]',
            'flex items-center justify-center flex-shrink-0',
          )}
        >
          <PlugZap size={13} className="text-white" />
        </span>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight flex-1">
          {t('connectionCenter.title', '连接中心')}
        </div>
        {real.length > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ring-1',
              summaryTone,
            )}
          >
            {tr(
              'connectionCenter.summary',
              { n: String(connectedCount), m: String(real.length) },
              '{n}/{m} 已连接',
            )}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close', '关闭')}
          className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="overflow-y-auto">
        {/* ── 消息频道 ── */}
        <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500">
          {t('connectionCenter.section.channels', '消息频道')}
        </div>
        <div className="mx-3 mb-1 rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.02] divide-y divide-gray-100 dark:divide-white/[0.04] overflow-hidden">
          {instances.length === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500">
              {t('settings.channels.empty', '没有可用渠道')}
            </p>
          ) : (
            instances.map((info) => (
              <ChannelRow
                key={info.manifest.id}
                info={info}
                liveStatus={liveStatus[info.manifest.id]}
                onConfigure={() => openSettings('#connection')}
              />
            ))
          )}
        </div>

        {/* ── 手机 / 浏览器接入 ── */}
        <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500">
          {t('connectionCenter.section.remote', '手机 / 浏览器接入')}
        </div>
        <div className="mx-3 mb-2 rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.02] overflow-hidden">
          <WebUiConnectBlock onOpenSettings={openSettings} />
        </div>
      </div>

      {/* 底栏: 完整设置 + 快捷键提示 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-200/70 dark:border-white/[0.07]">
        <button
          type="button"
          onClick={() => openSettings('#connection')}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <Settings size={12} />
          {t('connectionCenter.openSettings', '完整设置')} →
        </button>
        <div className="flex-1" />
        <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500">
          Alt+C
        </kbd>
      </div>
    </div>,
    document.body,
  )
}
