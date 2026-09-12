// =============================================================
// 飞书设置 Section(集成部分) — M5 连接中心拆分后的出站集成区
// 机器人凭证/连接管理已迁至「连接中心(消息频道)」ChannelsSection
// (channels.feishu.* + keystore);本节保留多维表格同步等数据源集成,
// 阶段 3 将并入连接中心「数据源集成」分组。
// UI 块: components/BitableAdvancedSection
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useEffect, useReducer, useState } from 'react'
import { useT } from '../../../i18n'
import { BitableAdvancedSection } from '../components/BitableAdvancedSection'
import { Section } from '../components/index'
import type { BitListAction, BitListStatus } from '../hooks/useBitableList'

interface FeishuSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

// T4 状态机(与 useBitableList 的动作类型对齐): 规避 React 19 setter 推断问题
function bitListReducer(state: BitListStatus, action: BitListAction): BitListStatus {
  if (action.type === 'LIST' && state === 'idle') return 'listing'
  if (action.type === 'SUCCESS' && state === 'listing') return 'success'
  if (action.type === 'ERROR' && (state === 'idle' || state === 'listing')) return 'error'
  if (action.type === 'RESET') return 'idle'
  return state
}

export function FeishuSection({ settings, onSave }: FeishuSectionProps) {
  const { t } = useT()
  // Bitable 高级配置
  const [bitableAppToken, setBitableAppToken] = useState<string>(
    settings.feishu?.bitableAppToken ?? '',
  )
  // C-4 修复语义保持: settings 值变化(含重置默认)时回填本地编辑态;
  // 键值即存即持久,同步不会覆盖未保存草稿
  useEffect(() => {
    setBitableAppToken(settings.feishu?.bitableAppToken ?? '')
  }, [settings.feishu?.bitableAppToken])
  const [bitableListStatus, dispatchBitList] = useReducer(bitListReducer, 'idle')
  const [bitableListInfo, setBitableListInfo] = useState<string>('')

  return (
    <Section title={t('settings.section.feishuIntegration', '飞书集成(数据源)')}>
      {/* 高级:Bitable 同步等不常用配置,默认收起 */}
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
    </Section>
  )
}
