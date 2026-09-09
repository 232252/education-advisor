// =============================================================
// 飞书设置 Section (编排层) — 长连接机器人状态徽章 + App ID/Secret + 首次使用指引 + Bitable 高级配置
// 状态自持(2026-09-05 下沉): botStatus(含订阅)/测试连接/Bitable 列表机/
// bitableAppToken 全部收归本节,SettingsPage 不再透传 14 个 props。
// UI 块: components/FeishuStatusBadge / FeishuGuidePanel / FeishuNetworkDiagnostics / BitableAdvancedSection
// 动作: hooks/useFeishuTest
// =============================================================

import type { FeishuBotStatusInfo, UnifiedSettings } from '@shared/types'
import { useEffect, useReducer, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { BTN_SM_BLUE, cn, INPUT_INVALID, INPUT_SM } from '../../../lib/ui-utils'
import { BitableAdvancedSection } from '../components/BitableAdvancedSection'
import { FeishuGuidePanel } from '../components/FeishuGuidePanel'
import { FeishuNetworkDiagnostics } from '../components/FeishuNetworkDiagnostics'
import { FeishuStatusBadge } from '../components/FeishuStatusBadge'
import { SecretInput, Section, SelectSettingRow, SettingRow } from '../components/index'
import type { BitListAction, BitListStatus } from '../hooks/useBitableList'
import { useFeishuTest } from '../hooks/useFeishuTest'

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
  // 长连接机器人状态(设置页徽章实时显示) — 挂载拉取一次 + 订阅后续变化
  const [botStatus, setBotStatus] = useState<FeishuBotStatusInfo | null>(null)
  useEffect(() => {
    getAPI()
      .feishu.botStatus()
      .then(setBotStatus)
      .catch((err) => console.warn('[SettingsPage] feishu botStatus initial fetch failed:', err))
    const unsub = getAPI().feishu.onBotStatusUpdate((info) => setBotStatus(info))
    return unsub
  }, [])
  // 测试连接
  const [feishuTestStatus, setFeishuTestStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle')
  const [feishuTestInfo, setFeishuTestInfo] = useState<string>('')
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

  // 飞书凭证配置状态: appId 已填 + secret 已保存到 keystore(占位符 '__keystore__')
  const hasAppId = !!settings.feishu.appId
  const secretSavedToKeystore = settings.feishu.appSecret === '__keystore__'
  const isConfigured = hasAppId && secretSavedToKeystore

  const handleTestConnection = useFeishuTest({
    appId: settings.feishu.appId,
    setFeishuTestStatus,
    setFeishuTestInfo,
  })

  return (
    <Section title={t('settings.section.feishu')}>
      {/* 连接状态徽章:实时反映长连接机器人状态 */}
      <FeishuStatusBadge
        botStatus={botStatus}
        hasAppId={hasAppId}
        secretSavedToKeystore={secretSavedToKeystore}
        isConfigured={isConfigured}
      />

      <SelectSettingRow
        path="feishu.domain"
        label={t('settings.feishu.domain')}
        description={t('settings.feishu.domain.desc')}
        value={settings.feishu.domain}
        options={[
          { value: 'feishu', label: t('settings.feishu.domainFeishu') },
          { value: 'lark', label: t('settings.feishu.domainLark') },
        ]}
        onSave={onSave}
        className="w-48"
      />

      <SettingRow
        label="App ID"
        path="feishu.appId"
        description={t(
          'page.settings.feishu.appIdDesc',
          '飞书开放平台应用 ID,以 cli_ 开头。填写并保存后自动连接。',
        )}
      >
        <input
          type="text"
          value={settings.feishu.appId}
          placeholder="cli_xxxxxxxx"
          onChange={(e) => onSave('feishu.appId', e.target.value)}
          className={cn(
            INPUT_SM,
            'w-48',
            settings.feishu.appId && !settings.feishu.appId.startsWith('cli_') && INPUT_INVALID,
          )}
        />
      </SettingRow>

      <SettingRow
        label="App Secret"
        path="feishu.appSecret"
        description={t(
          'page.settings.feishu.appSecretDesc',
          '飞书应用密钥,加密保存到本地 keystore,不外泄。保存后自动连接。',
        )}
      >
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <SecretInput
              value={settings.feishu.appSecret}
              onChange={(v) => onSave('feishu.appSecret', v)}
            />
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={feishuTestStatus === 'testing'}
              className={BTN_SM_BLUE}
            >
              {feishuTestStatus === 'testing'
                ? t('settings.feishu.testing', '测试中...')
                : t('settings.feishu.testConnection', '测试连接')}
            </button>
          </div>
          {feishuTestInfo && (
            <div
              className={`text-[10px] ${
                feishuTestStatus === 'success'
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : feishuTestStatus === 'error'
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {feishuTestInfo}
            </div>
          )}
        </div>
      </SettingRow>

      {/* 配置指引:首次使用必读,告知飞书后台需开启的权限与事件 */}
      <FeishuGuidePanel domain={settings.feishu.domain} />

      {/* 网络诊断:排查远程访问连接问题 */}
      <FeishuNetworkDiagnostics />

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
