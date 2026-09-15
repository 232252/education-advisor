// =============================================================
// MoreChannelsDrawer — 「更多」全量频道目录(Drawer 网格)
// 数据源: channels.list() manifests;分组/搜索纯函数见 @shared/channel-catalog
// =============================================================

import type { ChannelInstanceInfo, ChannelManifest, ChannelStatusInfo } from '@shared/types'
import {
  filterCatalogManifests,
  groupCatalogManifests,
  resolveCatalogStatus,
  type CatalogCardStatus,
} from '@shared/channel-catalog'
import { Ban, Clock, LayoutGrid, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { tr, useT } from '../../i18n'
import { cn } from '../../lib/ui-utils'
import { ChannelBrandIcon } from '../channel/ChannelBrandIcon'

interface MoreChannelsDrawerProps {
  open: boolean
  onClose: () => void
  instances: ChannelInstanceInfo[]
  liveStatus: Record<string, ChannelStatusInfo>
  onConfigure: (channelId: string) => void
}

function statusBadge(
  status: CatalogCardStatus,
  t: (k: string, d: string) => string,
): { label: string; className: string; icon?: ReactNode } {
  switch (status) {
    case 'enabled':
      return {
        label: t('connectionCenter.more.status.enabled', '可配置'),
        className:
          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20',
      }
    case 'comingSoon':
      return {
        label: t('connectionCenter.more.status.comingSoon', '即将推出'),
        className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
        icon: <Sparkles size={10} />,
      }
    case 'later':
      return {
        label: t('connectionCenter.more.status.later', '海外·稍后'),
        className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/20',
        icon: <Clock size={10} />,
      }
    case 'unsupported':
      return {
        label: t('connectionCenter.more.status.unsupported', '不支持'),
        className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20',
        icon: <Ban size={10} />,
      }
  }
}

function capabilityTag(m: ChannelManifest, pollingLabel: string): string {
  const via = m.capabilities?.receivesVia
  if (via === 'ws') return 'WS'
  if (via === 'polling') return pollingLabel
  if (via === 'webhook') return 'Webhook'
  if (via === 'mqtt') return 'MQTT'
  if (via === 'sip') return 'SIP'
  if (via === 'imap-idle') return 'IMAP'
  if (via === 'relay-ws') return 'Relay'
  return via || ''
}

function CatalogCard({
  manifest,
  instance,
  live,
  onConfigure,
}: {
  manifest: ChannelManifest
  instance?: ChannelInstanceInfo
  live?: ChannelStatusInfo
  onConfigure: (id: string) => void
}) {
  const { t } = useT()
  const status = resolveCatalogStatus(manifest)
  const badge = statusBadge(status, t)
  const run = live ?? instance?.status
  const connected = run?.status === 'connected'
  const muted = status === 'comingSoon' || status === 'later' || status === 'unsupported'
  const clickable = status === 'enabled'

  const handleClick = () => {
    if (!clickable) return
    onConfigure(manifest.id)
  }

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={handleClick}
      aria-label={manifest.label}
      className={cn(
        'text-left rounded-xl border p-3 transition-all',
        'border-gray-200/80 dark:border-white/[0.08]',
        clickable &&
          'hover:border-blue-300 dark:hover:border-blue-500/40 hover:bg-white dark:hover:bg-white/[0.04] cursor-pointer',
        muted && 'opacity-70 border-dashed cursor-default',
        status === 'unsupported' && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2.5">
        <ChannelBrandIcon
          channelId={manifest.id}
          label={manifest.label}
          icon={manifest.icon}
          size="sm"
          muted={muted}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {manifest.label}
            </span>
            {manifest.beta && (
              <span className="text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400">
                Beta
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-snug">
            {(status === 'unsupported' || status === 'later') && manifest.unsupportedReason
              ? manifest.unsupportedReason
              : manifest.description}
          </p>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1',
                connected
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20'
                  : badge.className,
              )}
            >
              {connected ? t('connectionCenter.more.status.connected', '已连接') : badge.label}
              {!connected && badge.icon}
            </span>
            {capabilityTag(manifest, t('connectionCenter.more.viaPolling', '轮询')) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400">
                {capabilityTag(manifest, t('connectionCenter.more.viaPolling', '轮询'))}
              </span>
            )}
            {manifest.loginKinds?.includes('qr') && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400">
                {t('connectionCenter.more.tag.qr', '扫码')}
              </span>
            )}
            {manifest.limitationBannerKey && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                {t('connectionCenter.more.tag.weakPush', '弱主动')}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

export function MoreChannelsDrawer({
  open,
  onClose,
  instances,
  liveStatus,
  onConfigure,
}: MoreChannelsDrawerProps) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const manifests = useMemo(() => instances.map((i) => i.manifest), [instances])
  const byId = useMemo(() => {
    const m = new Map<string, ChannelInstanceInfo>()
    for (const i of instances) m.set(i.manifest.id, i)
    return m
  }, [instances])

  const buckets = useMemo(() => {
    const filtered = filterCatalogManifests(manifests, query)
    return groupCatalogManifests(filtered)
  }, [manifests, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const init: Record<string, boolean> = {}
    for (const b of groupCatalogManifests(manifests)) {
      if (b.group.collapsedByDefault) init[b.group.id] = true
    }
    setCollapsed(init)
    const tmr = window.setTimeout(() => searchRef.current?.focus(), 50)
    return () => window.clearTimeout(tmr)
  }, [open, manifests])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[80]" data-testid="more-channels-drawer">
      <button
        type="button"
        aria-label={t('common.close', '关闭')}
        className="absolute inset-0 bg-black/35 dark:bg-black/55 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('connectionCenter.more.title', '全部频道')}
        className={cn(
          'absolute right-0 top-0 h-full w-[min(560px,100vw)]',
          'bg-white dark:bg-surface-elevated shadow-2xl',
          'dark:ring-1 dark:ring-white/[0.07] border-l border-gray-200/70 dark:border-white/[0.08]',
          'flex flex-col animate-slide-in-right',
        )}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200/70 dark:border-white/[0.07]">
          <span
            aria-hidden
            className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center ring-1 ring-white/20"
          >
            <LayoutGrid size={14} className="text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('connectionCenter.more.title', '全部频道')}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {tr(
                'connectionCenter.more.subtitle',
                { n: String(manifests.length) },
                '对齐 QwenPaw · {n} 个栏目',
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', '关闭')}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.05]">
          <label className="relative block">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('connectionCenter.more.search', '搜索频道…')}
              aria-label={t('connectionCenter.more.search', '搜索频道…')}
              className={cn(
                'w-full pl-9 pr-3 py-2 text-sm rounded-lg',
                'bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08]',
                'text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
                'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400',
              )}
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {buckets.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
              {t('connectionCenter.more.empty', '未找到匹配频道')}
            </p>
          ) : (
            buckets.map(({ group, items }) => {
              const isCollapsed = collapsed[group.id] === true
              return (
                <section key={group.id} aria-labelledby={`catalog-group-${group.id}`}>
                  <button
                    type="button"
                    id={`catalog-group-${group.id}`}
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                    }
                    className="sticky top-0 z-[1] w-full flex items-center gap-2 py-1.5 bg-white/95 dark:bg-surface-elevated/95 backdrop-blur-sm"
                  >
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500">
                      {t(group.labelKey, group.labelDefault)}
                    </span>
                    <span className="text-[10px] text-gray-400">{items.length}</span>
                    <span className="flex-1 border-t border-gray-100 dark:border-white/[0.06]" />
                    <span className="text-[10px] text-gray-400">{isCollapsed ? '▸' : '▾'}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
                      {items.map((m) => (
                        <CatalogCard
                          key={m.id}
                          manifest={m}
                          instance={byId.get(m.id)}
                          live={liveStatus[m.id]}
                          onConfigure={onConfigure}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
