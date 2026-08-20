// =============================================================
// 飞书设置 Section (编排层) — 长连接机器人状态徽章 + App ID/Secret + 首次使用指引 + Bitable 高级配置
// 注: 此 Section 是 Settings 中耦合最重的,需要把 botStatus / feishuTestStatus /
// bitableAppToken / bitableListStatus 等多个状态(及其 setter / dispatch)以 props 传入。
// 状态本身仍保留在 SettingsPage,本组件仅做展示 + 回调通知。
// UI 块: components/FeishuStatusBadge / FeishuGuidePanel / FeishuNetworkDiagnostics / BitableAdvancedSection
// 动作: hooks/useFeishuTest
// =============================================================

import type { FeishuBotStatusInfo, UnifiedSettings } from '@shared/types'
import { useT } from '../../../i18n'
import { cn, INPUT_INVALID, INPUT_SM } from '../../../lib/ui-utils'
import { BitableAdvancedSection } from '../components/BitableAdvancedSection'
import { FeishuGuidePanel } from '../components/FeishuGuidePanel'
import { FeishuNetworkDiagnostics } from '../components/FeishuNetworkDiagnostics'
import { FeishuStatusBadge } from '../components/FeishuStatusBadge'
import { SecretInput, Section, SettingRow } from '../components/index'
import type { BitListAction, BitListStatus } from '../hooks/useBitableList'
import { useFeishuTest } from '../hooks/useFeishuTest'

export interface FeishuSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
  // 长连接机器人状态
  botStatus: FeishuBotStatusInfo | null
  // 测试连接相关(state + setter)
  feishuTestStatus: 'idle' | 'testing' | 'success' | 'error'
  feishuTestInfo: string
  setFeishuTestStatus: (s: 'idle' | 'testing' | 'success' | 'error') => void
  setFeishuTestInfo: (s: string) => void
  // Bitable 高级配置(state + setter)
  bitableAppToken: string
  setBitableAppToken: (s: string) => void
  bitableListStatus: BitListStatus
  dispatchBitList: (action: BitListAction) => void
  bitableListInfo: string
  setBitableListInfo: (s: string) => void
}

export function FeishuSection({
  settings,
  onSave,
  botStatus,
  feishuTestStatus,
  feishuTestInfo,
  setFeishuTestStatus,
  setFeishuTestInfo,
  bitableAppToken,
  setBitableAppToken,
  bitableListStatus,
  dispatchBitList,
  bitableListInfo,
  setBitableListInfo,
}: FeishuSectionProps) {
  const { t } = useT()

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

      <SettingRow
        label={t('settings.feishu.domain')}
        path="feishu.domain"
        description={t('settings.feishu.domain.desc')}
      >
        <select
          value={settings.feishu.domain}
          onChange={(e) => onSave('feishu.domain', e.target.value)}
          className={cn(INPUT_SM, 'w-48')}
        >
          <option value="feishu">{t('settings.feishu.domainFeishu')}</option>
          <option value="lark">{t('settings.feishu.domainLark')}</option>
        </select>
      </SettingRow>

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
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
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
                    ? 'text-rose-500 dark:text-rose-400'
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
