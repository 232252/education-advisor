// =============================================================
// 飞书设置 Section — 长连接机器人状态徽章 + App ID/Secret + 首次使用指引 + Bitable 高级配置
// 注: 此 Section 是 Settings 中耦合最重的,需要把 botStatus / feishuTestStatus /
// bitableAppToken / bitableListStatus 等多个状态(及其 setter / dispatch)以 props 传入。
// 状态本身仍保留在 SettingsPage,本组件仅做展示 + 回调通知。
// =============================================================

import type { FeishuBotStatusInfo, UnifiedSettings } from '@shared/types'
import { useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { cn, INPUT_INVALID, INPUT_SM } from '../../../lib/ui-utils'
import { SecretInput, Section, SettingRow, ToggleSwitch } from '../components'

// Bitable 列表状态机的状态/动作类型(与 SettingsPage 内 useReducer 对齐)
type BitListStatus = 'idle' | 'listing' | 'success' | 'error'
type BitListAction = { type: 'LIST' } | { type: 'SUCCESS' } | { type: 'ERROR' } | { type: 'RESET' }

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
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnoseResult, setDiagnoseResult] = useState<{
    steps: Array<{
      name: string
      status: 'pass' | 'fail' | 'skip'
      latencyMs?: number
      detail: string
      suggestion?: string
    }>
    overall: 'pass' | 'fail'
  } | null>(null)

  // 飞书凭证配置状态: appId 已填 + secret 已保存到 keystore(占位符 '__keystore__')
  const hasAppId = !!settings.feishu.appId
  const secretSavedToKeystore = settings.feishu.appSecret === '__keystore__'
  const isConfigured = hasAppId && secretSavedToKeystore

  const handleDiagnose = async () => {
    setDiagnosing(true)
    setDiagnoseResult(null)
    try {
      const result = await getAPI().feishu.diagnose()
      setDiagnoseResult(result)
    } catch {
      setDiagnoseResult({
        steps: [],
        overall: 'fail',
      })
    } finally {
      setDiagnosing(false)
    }
  }

  return (
    <Section title={t('settings.section.feishu')}>
      {/* 连接状态徽章:实时反映长连接机器人状态 */}
      <div className="px-5 py-3 flex items-center gap-2 bg-gray-50 dark:bg-surface-elevated/40 border-b border-gray-200 dark:border-white/[0.06]/60">
        <span
          className={`w-2 h-2 rounded-full ${
            botStatus?.status === 'connected'
              ? 'bg-emerald-400 animate-pulse'
              : botStatus?.status === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : botStatus?.status === 'error'
                  ? 'bg-rose-400'
                  : 'bg-gray-400 dark:bg-gray-500'
          }`}
        />
        <span className="text-xs text-gray-600 dark:text-gray-300">
          {botStatus?.status === 'connected'
            ? `已连接${botStatus.appId ? ` · ${botStatus.appId.slice(0, 12)}...` : ''}`
            : botStatus?.status === 'connecting'
              ? '连接中...'
              : botStatus?.status === 'error'
                ? `连接失败${botStatus.error ? ` · ${botStatus.error}` : ''}`
                : !hasAppId
                  ? '未配置 · 请填写 App ID 和 App Secret 并保存'
                  : !secretSavedToKeystore
                    ? '未保存 · 请点击下方"保存"按钮将凭证写入本地加密存储'
                    : '未连接'}
        </span>
        {botStatus?.status === 'connected' &&
          botStatus.processingCount &&
          botStatus.processingCount > 0 && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 ml-1">
              处理中 {botStatus.processingCount}
            </span>
          )}
        <div className="flex-1" />
        {botStatus?.status === 'connected' ? (
          <button
            type="button"
            onClick={() => getAPI().feishu.botStop()}
            className="text-[10px] px-2 py-1 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            断开
          </button>
        ) : (
          <button
            type="button"
            onClick={() => getAPI().feishu.botStart()}
            disabled={!isConfigured}
            title={
              !hasAppId
                ? '请先填写 App ID'
                : !secretSavedToKeystore
                  ? '请先点击"保存"按钮,将 App Secret 加密存储到本地'
                  : '启动飞书长连接机器人'
            }
            className="text-[10px] px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            连接
          </button>
        )}
      </div>

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
        description="飞书开放平台应用 ID,以 cli_ 开头。填写并保存后自动连接。"
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
        description="飞书应用密钥,加密保存到本地 keystore,不外泄。保存后自动连接。"
      >
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <SecretInput
              value={settings.feishu.appSecret}
              onChange={(v) => onSave('feishu.appSecret', v)}
            />
            <button
              type="button"
              onClick={async () => {
                if (!settings.feishu.appId) {
                  setFeishuTestStatus('error')
                  setFeishuTestInfo('请先填写 App ID')
                  return
                }
                setFeishuTestStatus('testing')
                setFeishuTestInfo('正在测试...')
                // appSecret 从 keystore 读取，不再通过参数传递
                const result = await getAPI().feishu.test(settings.feishu.appId)
                if (result.success) {
                  setFeishuTestStatus('success')
                  setFeishuTestInfo(
                    // R6-2 修复: 不在 UI 显示 token 明文,避免敏感信息泄露
                    `连接成功 · 过期 ${result.expireSec}s`,
                  )
                } else {
                  setFeishuTestStatus('error')
                  // 防御: 错误信息可能是对象, 统一转字符串避免 UI 显示 "[object Object]"
                  setFeishuTestInfo(
                    `连接失败 · ${
                      typeof result.error === 'string' ? result.error : JSON.stringify(result.error)
                    }`,
                  )
                }
              }}
              disabled={feishuTestStatus === 'testing'}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            >
              {feishuTestStatus === 'testing' ? '测试中...' : '测试连接'}
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
      <div className="px-5 py-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 bg-blue-50/50 dark:bg-blue-900/10 border-t border-gray-200 dark:border-white/[0.06]/60">
        <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">首次使用飞书对话</div>
        <div className="mb-1 text-emerald-600 dark:text-emerald-400">
          采用长连接模式:无需公网 IP、无需内网穿透,本机在任意网络(含家庭/校园网)都能远程收发消息。
        </div>
        填好 App ID 和 App Secret 后,还需在
        <a
          href={
            settings.feishu.domain === 'lark'
              ? 'https://open.larksuite.com'
              : 'https://open.feishu.cn'
          }
          target="_blank"
          rel="noreferrer"
          className="text-blue-500 dark:text-blue-400 underline mx-0.5"
        >
          {settings.feishu.domain === 'lark' ? 'Lark Open Platform' : '飞书开放平台'}
        </a>
        后台为该应用:
        <ol className="list-decimal ml-4 mt-1 space-y-0.5">
          <li>「应用能力」→ 启用「机器人」能力</li>
          <li>「事件与回调」→ 订阅方式选「使用长连接接收事件」</li>
          <li>添加事件「接收消息 v2.0」(im.message.receive_v1)</li>
          <li>「权限管理」开启:im:message、im:message:send_as_bot</li>
          <li>创建版本并发布(企业自建应用需管理员审核通过)</li>
        </ol>
        配好后点下方「保存」按钮,再点上方「连接」,即可在飞书里直接对话,发 /help 查看命令。
      </div>

      {/* 网络诊断:排查远程访问连接问题 */}
      <div className="px-5 py-3 border-t border-gray-200 dark:border-white/[0.06]/60">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">网络诊断</span>
          <button
            type="button"
            onClick={handleDiagnose}
            disabled={diagnosing}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
          >
            {diagnosing ? '诊断中...' : '开始诊断'}
          </button>
          {diagnoseResult && !diagnosing && (
            <span
              className={`text-[10px] font-medium ${
                diagnoseResult.overall === 'pass'
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : 'text-rose-500 dark:text-rose-400'
              }`}
            >
              {diagnoseResult.overall === 'pass' ? '✓ 全部通过' : '✗ 存在问题'}
            </span>
          )}
        </div>
        {diagnoseResult && diagnoseResult.steps.length > 0 && (
          <div className="space-y-1.5">
            {diagnoseResult.steps.map((step) => (
              <div
                key={`diagnose-${step.name}`}
                className="flex items-start gap-2 text-[11px] leading-relaxed"
              >
                <span
                  className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    step.status === 'pass'
                      ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : step.status === 'fail'
                        ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                        : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                  }`}
                >
                  {step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '-'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {step.name}
                    </span>
                    {step.latencyMs !== undefined && (
                      <span className="text-gray-400 dark:text-gray-500">{step.latencyMs}ms</span>
                    )}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">{step.detail}</div>
                  {step.suggestion && (
                    <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                      建议: {step.suggestion}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {diagnoseResult && diagnoseResult.steps.length === 0 && (
          <div className="text-[11px] text-rose-500 dark:text-rose-400">
            诊断失败,请检查应用日志
          </div>
        )}
      </div>

      {/* 高级:Bitable 同步等不常用配置,默认收起 */}
      <details className="border-t border-gray-200 dark:border-white/[0.06]/60">
        <summary className="px-5 py-2.5 text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 select-none">
          高级(Bitable 多维表格同步)
        </summary>
        <div className="divide-y divide-gray-200 dark:divide-gray-700/60">
          <SettingRow
            label="Bitable App Token"
            path="feishu.bitableAppToken"
            description="飞书多维表格的 app_token(在 bitable URL 中可找到)"
          >
            <input
              type="text"
              value={bitableAppToken}
              placeholder="bascnXXXXXXXXXX"
              onChange={(e) => {
                const v = e.target.value
                setBitableAppToken(v)
                // C-4 修复: 同步持久化到 settings,之前只更新本地 state 导致重启丢失
                onSave('feishu.bitableAppToken', v)
              }}
              className={cn(INPUT_SM, 'w-48')}
            />
          </SettingRow>

          <SettingRow
            label="Bitable 列表"
            path="feishu.bitableList"
            description="点击拉取 Bitable 下所有表,验证凭证有效性"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="拉取 Bitable 表列表"
                title="拉取 Bitable 表列表"
                onClick={async () => {
                  if (!settings.feishu.appId || !bitableAppToken) {
                    setBitableListInfo('请先填写 App ID 和 Bitable App Token')
                    return
                  }
                  setBitableListInfo('正在拉取...')
                  dispatchBitList({ type: 'LIST' })
                  const result = await getAPI().feishu.listBitable(
                    settings.feishu.appId,
                    bitableAppToken,
                  )
                  if (result.success && result.tables) {
                    dispatchBitList({ type: 'SUCCESS' })
                    setBitableListInfo(
                      `找到 ${result.tables.length} 个表: ${result.tables.map((t) => t.name).join(', ')}`,
                    )
                  } else {
                    dispatchBitList({ type: 'ERROR' })
                    setBitableListInfo(`拉取失败 · ${result.error || '未知错误'}`)
                  }
                }}
                disabled={bitableListStatus === 'listing'}
                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
              >
                {bitableListStatus === 'listing' ? '拉取中...' : '拉取列表'}
              </button>
            </div>
            {bitableListInfo && (
              <div
                className={`text-[10px] mt-1 ${
                  bitableListStatus === 'success'
                    ? 'text-emerald-500 dark:text-emerald-400'
                    : bitableListStatus === 'error'
                      ? 'text-rose-500 dark:text-rose-400'
                      : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {bitableListInfo}
              </div>
            )}
          </SettingRow>

          <SettingRow
            label="Bitable 同步"
            path="feishu.bitableSync.enabled"
            description="定时把 AI 报告同步到飞书多维表格"
          >
            <ToggleSwitch
              checked={settings.feishu.bitableSync.enabled}
              onChange={(v) => onSave('feishu.bitableSync.enabled', v)}
              label="Bitable 同步"
            />
          </SettingRow>

          <SettingRow
            label="同步间隔"
            path="feishu.bitableSync.syncInterval"
            description="自动同步的时间间隔，支持 cron 表达式（如 0 */6 * * *）或分钟数"
          >
            <input
              type="text"
              value={settings.feishu.bitableSync.syncInterval}
              placeholder="0 */6 * * *"
              onChange={(e) => onSave('feishu.bitableSync.syncInterval', e.target.value)}
              className={cn(INPUT_SM, 'w-40')}
              disabled={!settings.feishu.bitableSync.enabled}
            />
          </SettingRow>
        </div>
      </details>
    </Section>
  )
}
