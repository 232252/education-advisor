// 插件没有的本机渠道：MQTT、元宝、小艺、Mattermost。
// 飞书、企微、邮件这些登录留在 dsh-im，这里不再做第二套卡片。

import { isDshImChannel } from '@shared/dsh-im-channels'
import type { ChannelInstanceInfo, ChannelStatusInfo, UnifiedSettings } from '@shared/types'
import { useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { ChannelCard } from './ChannelCard'
import { ChannelConfigPanel } from './ChannelConfigPanel'

interface LocalChannelCardsProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function isLocalConfigurableChannel(info: ChannelInstanceInfo): boolean {
  if (isDshImChannel(info.manifest.id)) return false
  if (info.manifest.comingSoon) return false
  const status = info.manifest.catalogStatus
  return status !== 'comingSoon' && status !== 'later' && status !== 'unsupported'
}

export function LocalChannelCards({ settings, onSave }: LocalChannelCardsProps) {
  const { t } = useT()
  const [rows, setRows] = useState<ChannelInstanceInfo[]>([])
  const [live, setLive] = useState<Record<string, ChannelStatusInfo>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    void getAPI()
      .channels.list()
      .then((list) => {
        if (!stop) setRows(list.filter(isLocalConfigurableChannel))
      })
      .catch(() => {
        if (!stop) setRows([])
      })
    const unsubscribe = getAPI().channels.onStatusUpdate((info) => {
      setLive((current) => ({ ...current, [info.channel]: info }))
    })
    return () => {
      stop = true
      unsubscribe()
    }
  }, [])

  if (rows.length === 0) return null

  const channelSettings = settings.channels as unknown as Record<string, Record<string, unknown>>

  return (
    <div className="mt-5">
      <h4 className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 mb-2">
        {t('settings.channels.local.title', '本机渠道')}
      </h4>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2 leading-relaxed">
        {t(
          'settings.channels.local.intro',
          '聊天软件的登录在上面的 IM 插件里。这里只配置插件没有的渠道。',
        )}
      </p>
      <div className="grid grid-cols-1 gap-3">
        {rows.map((info) => (
          <ChannelCard
            key={info.manifest.id}
            info={info}
            liveStatus={live[info.manifest.id]}
            expanded={expanded === info.manifest.id}
            onToggleExpand={() =>
              setExpanded((current) => (current === info.manifest.id ? null : info.manifest.id))
            }
            onSave={onSave}
          >
            <ChannelConfigPanel
              info={info}
              settings={{ channels: channelSettings }}
              onSave={onSave}
            />
          </ChannelCard>
        ))}
      </div>
    </div>
  )
}
