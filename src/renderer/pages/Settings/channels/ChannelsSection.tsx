// =============================================================
// ChannelsSection — 设置里的连接中心
// 聊天软件登录走侧栏那块 dsh-im。
// 多维表格和教师推送仍用这里的开放平台 App ID / Secret。
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { Smartphone } from 'lucide-react'
import { useEffect, useReducer, useState } from 'react'
import { requestOpenConnectionCenter } from '../../../components/connection-center/open-connection-center'
import { useT } from '../../../i18n'
import { INPUT_SM } from '../../../lib/ui-utils'
import { Section } from '../components'
import { BitableAdvancedSection } from '../components/BitableAdvancedSection'
import { SecretInput } from '../components/SecretInput'
import { SettingRow } from '../components/SettingRow'
import { ToggleSettingRow } from '../components/ToggleSettingRow'
import type { BitListAction, BitListStatus } from '../hooks/useBitableList'
import { LocalChannelCards } from './LocalChannelCards'

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

  // 数据源集成(bitable)本地编辑态(原 FeishuSection 迁入)
  const [bitableAppToken, setBitableAppToken] = useState<string>(
    settings.feishu?.bitableAppToken ?? '',
  )
  useEffect(() => {
    setBitableAppToken(settings.feishu?.bitableAppToken ?? '')
  }, [settings.feishu?.bitableAppToken])
  const [bitableListStatus, dispatchBitList] = useReducer(bitListReducer, 'idle')
  const [bitableListInfo, setBitableListInfo] = useState<string>('')
  const [appId, setAppId] = useState(settings.feishu?.appId ?? '')
  const [appSecret, setAppSecret] = useState(settings.feishu?.appSecret ?? '')
  const [userOpenId, setUserOpenId] = useState(settings.feishu?.userOpenId ?? '')
  useEffect(() => {
    setAppId(settings.feishu?.appId ?? '')
    setAppSecret(settings.feishu?.appSecret ?? '')
    setUserOpenId(settings.feishu?.userOpenId ?? '')
  }, [settings.feishu?.appId, settings.feishu?.appSecret, settings.feishu?.userOpenId])

  return (
    <Section id="connection" title={t('settings.section.channels', '连接中心')}>
      <div className="px-5 py-4">
        <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
          <Smartphone size={13} className="flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
          <span>
            {t('settings.channels.intro', '微信、飞书、企微、钉钉和 QQ 的登录都在 IM 插件里完成。')}
          </span>
        </p>
        <button
          type="button"
          data-testid="settings-open-im-plugin"
          onClick={() => requestOpenConnectionCenter()}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          {t('settings.channels.openPlugin', '打开 IM 插件')}
        </button>

        <LocalChannelCards settings={settings} onSave={onSave} />

        {/* ===== 数据源集成(出站;原「飞书集成」区迁入,阶段 2 收口) ===== */}
        <div className="mt-5">
          <h4 className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 mb-2">
            {t('settings.channels.datasource.title', '数据源集成')}
          </h4>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2 leading-relaxed">
            {t(
              'settings.channels.datasource.intro',
              '聊天登录在上面的 IM 插件里。这里的 App ID 只给出站：把报告写入多维表格，或把定时结果推给教师。',
            )}
          </p>
          <div className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary shadow-sm mb-3 divide-y divide-gray-200 dark:divide-gray-700/60">
            <SettingRow
              label={t('settings.channels.datasource.appId', 'App ID')}
              path="feishu.appId"
              description={t(
                'settings.channels.datasource.appId.desc',
                '飞书开放平台应用 ID，以 cli_ 开头',
              )}
            >
              <input
                type="text"
                value={appId}
                placeholder="cli_"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setAppId(e.target.value)}
                onBlur={() => {
                  const next = appId.trim()
                  if (next !== (settings.feishu?.appId ?? '')) onSave('feishu.appId', next)
                }}
                className={`${INPUT_SM} w-48`}
              />
            </SettingRow>
            <SettingRow
              label={t('settings.channels.datasource.appSecret', 'App Secret')}
              path="feishu.appSecret"
              description={t(
                'settings.channels.datasource.appSecret.desc',
                '加密存在本机，不会写进设置文件',
              )}
            >
              <SecretInput
                value={appSecret}
                onChange={setAppSecret}
                onBlur={() => {
                  if (appSecret !== (settings.feishu?.appSecret ?? '')) {
                    onSave('feishu.appSecret', appSecret.trim())
                  }
                }}
              />
            </SettingRow>
            <SettingRow
              label={t('settings.channels.datasource.openId', '教师 open_id')}
              path="feishu.userOpenId"
              description={t(
                'settings.channels.datasource.openId.desc',
                '教师推送的接收人。多维表格同步不需要这一项',
              )}
            >
              <input
                type="text"
                value={userOpenId}
                placeholder="ou_"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setUserOpenId(e.target.value)}
                onBlur={() => {
                  const next = userOpenId.trim()
                  if (next !== (settings.feishu?.userOpenId ?? ''))
                    onSave('feishu.userOpenId', next)
                }}
                className={`${INPUT_SM} w-48`}
              />
            </SettingRow>
          </div>
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
