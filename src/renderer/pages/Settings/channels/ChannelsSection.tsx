// =============================================================
// ChannelsSection — 连接中心(阶段 2 收口: 消息频道 + 数据源集成)
// 信息架构(实施文档 §4.1 + 阶段 2 迁入):
//   「消息频道」= 渠道卡片墙(manifest 驱动,飞书/钉钉/…)
//   「数据源集成」= 出站集成(bitable 同步/教师推送,原 FeishuSection 迁入)
// 数据: channels:list(挂载拉取) + IPC_CHANNELS_STATUS_UPDATE 订阅实时态;
// 配置保存走 settings:set(dotPath) — 保存即重连在主进程联动。
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo, UnifiedSettings } from '@shared/types'
import { Smartphone } from 'lucide-react'
import { useEffect, useReducer, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { Section } from '../components'
import { BitableAdvancedSection } from '../components/BitableAdvancedSection'
import { FeishuNetworkDiagnostics } from '../components/FeishuNetworkDiagnostics'
import { ToggleSettingRow } from '../components/ToggleSettingRow'
import type { BitListAction, BitListStatus } from '../hooks/useBitableList'
import { ChannelCard } from './ChannelCard'
import { ChannelConfigPanel } from './ChannelConfigPanel'

interface ChannelsSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

// T4 状态机(与 useBitableList 的动作类型对齐;原 FeishuSection 同款)
function bitListReducer(state: BitListStatus, action: BitListAction): BitListStatus {
  if (action.type === 'LIST' && state === 'idle') return 'listing'
  if (action.type === 'SUCCESS' && state === 'listing') return 'success'
  if (action.type === 'ERROR' && (state === 'idle' || state === 'listing')) return 'error'
  if (action.type === 'RESET') return 'idle'
  return state
}

export function ChannelsSection({ settings, onSave }: ChannelsSectionProps) {
  const { t } = useT()
  const [instances, setInstances] = useState<ChannelInstanceInfo[]>([])
  const [liveStatus, setLiveStatus] = useState<Record<string, ChannelStatusInfo>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 数据源集成(bitable)本地编辑态(原 FeishuSection 迁入)
  const [bitableAppToken, setBitableAppToken] = useState<string>(
    settings.feishu?.bitableAppToken ?? '',
  )
  useEffect(() => {
    setBitableAppToken(settings.feishu?.bitableAppToken ?? '')
  }, [settings.feishu?.bitableAppToken])
  const [bitableListStatus, dispatchBitList] = useReducer(bitListReducer, 'idle')
  const [bitableListInfo, setBitableListInfo] = useState<string>('')

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
    <Section id="connection" title={t('settings.section.channels', '连接中心')}>
      <div className="px-5 py-4">
        <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
          <Smartphone size={13} className="flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
          <span>
            {t(
              'settings.channels.intro',
              '让手机/平板上的聊天软件直接指挥这台电脑上的 AI 助教。长连接模式,无需公网 IP。',
            )}
          </span>
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

        {/* ===== 数据源集成(出站;原「飞书集成」区迁入,阶段 2 收口) ===== */}
        <div className="mt-5">
          <h4 className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 mb-2">
            {t('settings.channels.datasource.title', '数据源集成')}
          </h4>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2 leading-relaxed">
            {t(
              'settings.channels.datasource.intro',
              'AI 结果的出站去向(与消息频道共用飞书凭证):定时同步报告到多维表格、把定时任务结果推送给教师。',
            )}
          </p>
          <div className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.04] flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t('settings.channels.datasource.feishu', '飞书多维表格同步')}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  settings.feishu?.bitableSync?.enabled
                    ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-surface-elevated text-gray-500 dark:text-gray-400'
                }`}
              >
                {settings.feishu?.bitableSync?.enabled
                  ? t('common.enabled', '已启用')
                  : t('common.disabled', '已停用')}
              </span>
            </div>
            <BitableAdvancedSection
              settings={settings}
              onSave={onSave}
              bitableAppToken={bitableAppToken}
              setBitableAppToken={setBitableAppToken}
              bitableListStatus={bitableListStatus}
              dispatchBitList={dispatchBitList}
              bitableListInfo={bitableListInfo}
              setBitableListInfo={setBitableListInfo}
            />
            <div className="divide-y divide-gray-200 dark:divide-gray-700/60">
              <ToggleSettingRow
                path="feishu.agentPushEnabled"
                label={t('settings.channels.datasource.agentPush', '教师推送')}
                description={t(
                  'settings.channels.datasource.agentPush.desc',
                  '定时任务(周报/风险预警)完成后把结果推送给教师,默认关闭',
                )}
                value={settings.feishu?.agentPushEnabled === true}
                onSave={onSave}
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
