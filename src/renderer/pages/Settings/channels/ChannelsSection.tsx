// =============================================================
// ChannelsSection — 连接中心(消息频道卡片墙,M5)
// 信息架构(实施文档 §4.1):「消息频道」分组 = 卡片墙(飞书 + 即将支持占位),
// 「数据源集成」分组 = 提示(bitable/推送设置仍在下方"飞书集成"区,阶段 3 迁入)。
// 数据: channels:list(挂载拉取) + IPC_CHANNELS_STATUS_UPDATE 订阅实时态;
// 配置保存走 settings:set(dotPath) — 保存即重连在主进程联动。
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo, UnifiedSettings } from '@shared/types'
import { useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { Section } from '../components'
import { FeishuNetworkDiagnostics } from '../components/FeishuNetworkDiagnostics'
import { ChannelCard } from './ChannelCard'
import { ChannelConfigPanel } from './ChannelConfigPanel'

interface ChannelsSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function ChannelsSection({ settings, onSave }: ChannelsSectionProps) {
  const { t } = useT()
  const [instances, setInstances] = useState<ChannelInstanceInfo[]>([])
  const [liveStatus, setLiveStatus] = useState<Record<string, ChannelStatusInfo>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 挂载拉取渠道目录 + 订阅状态变化(卸载时取消订阅防泄漏)
  useEffect(() => {
    let disposed = false
    getAPI()
      .channels.list()
      .then((list) => {
        if (!disposed) setInstances(list)
      })
      .catch((err) => console.warn('[ChannelsSection] list failed:', err))
    const unsub = getAPI().channels.onStatusUpdate((info) => {
      setLiveStatus((prev) => ({ ...prev, [info.channel]: info }))
    })
    return () => {
      disposed = true
      unsub()
    }
  }, [])

  // 设置保存后刷新派生态(configured/enabled 会变化;轻量重新拉取)
  useEffect(() => {
    getAPI()
      .channels.list()
      .then((list) => setInstances(list))
      .catch(() => {})
  }, [settings.channels])

  return (
    <Section title={t('settings.section.channels', '连接中心(消息频道)')}>
      <div className="px-5 py-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
          {t(
            'settings.channels.intro',
            '让手机/平板上的聊天软件直接指挥这台电脑上的 AI 助教。长连接模式,无需公网 IP。',
          )}
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
          {instances.map((info) => (
            <ChannelCard
              key={info.manifest.id}
              info={info}
              liveStatus={liveStatus[info.manifest.id]}
              expanded={expandedId === info.manifest.id}
              onToggleExpand={() =>
                setExpandedId((cur) => (cur === info.manifest.id ? null : info.manifest.id))
              }
              onSave={onSave}
            >
              <ChannelConfigPanel
                info={info}
                settings={settings}
                onSave={onSave}
                extra={info.manifest.id === 'feishu' ? <FeishuNetworkDiagnostics /> : null}
              />
            </ChannelCard>
          ))}
          {instances.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('settings.channels.empty', '没有可用渠道')}
            </p>
          )}
        </div>

        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3">
          {t(
            'settings.channels.integrationHint',
            '多维表格同步/教师推送等数据源集成设置在下方「飞书集成」区,后续将并入连接中心。',
          )}
        </p>
      </div>
    </Section>
  )
}
