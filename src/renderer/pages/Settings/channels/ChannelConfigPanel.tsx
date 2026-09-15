// =============================================================
// ChannelConfigPanel — 渠道卡片展开态(M5 连接中心)
// manifest 驱动:SchemaForm(表单) + 平台操作清单(setupGuide) +
// 测试连接(channels:test = validateConfig + 显式鉴权) + 最近错误。
// 渠道差异全部来自 manifest,本组件渠道无关。
// =============================================================

import type { ChannelInstanceInfo } from '@shared/types'
import { useState } from 'react'
import { ChannelLimitationBanner } from '../../../components/connection-center/ChannelLimitationBanner'
import { ChannelQrLogin } from '../../../components/connection-center/ChannelQrLogin'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { BTN_SM_BLUE } from '../../../lib/ui-utils'
import { SchemaForm } from './SchemaForm'

interface ChannelConfigPanelProps {
  info: ChannelInstanceInfo
  settings: { channels: Record<string, Record<string, unknown>> }
  onSave: (path: string, value: unknown) => void
  /** 渠道专属附加块(如飞书网络诊断) — 由 ChannelsSection 按渠道注入 */
  extra?: React.ReactNode
}

type TestState = { phase: 'idle' | 'testing' | 'ok' | 'error'; message: string }

export function ChannelConfigPanel({ info, settings, onSave, extra }: ChannelConfigPanelProps) {
  const { t } = useT()
  const [test, setTest] = useState<TestState>({ phase: 'idle', message: '' })
  const channelId = info.manifest.id
  const values = settings.channels[channelId] ?? {}

  const handleTest = async () => {
    setTest({ phase: 'testing', message: t('settings.channels.testing', '测试中…') })
    try {
      const r = await getAPI().channels.test(channelId)
      setTest(
        r.ok
          ? { phase: 'ok', message: r.message || t('settings.channels.testOk', '凭证有效') }
          : { phase: 'error', message: r.message },
      )
    } catch (err) {
      setTest({
        phase: 'error',
        message: err instanceof Error ? err.message : t('settings.channels.testFailed', '测试失败'),
      })
    }
  }

  const supportsQr = info.manifest.loginKinds?.includes('qr') === true

  return (
    <div className="divide-y divide-gray-200 dark:divide-white/[0.06]">
      {info.manifest.limitationBannerKey && (
        <div className="px-5 py-3">
          <ChannelLimitationBanner bannerKey={info.manifest.limitationBannerKey} />
        </div>
      )}

      {supportsQr && (
        <div className="px-5 py-4">
          <ChannelQrLogin
            channelId={channelId}
            onConfirmed={() => {
              // 凭证已写入;提示用户可测试/启用
            }}
          />
        </div>
      )}

      {/* ① manifest 声明的配置表单(schema 驱动,新渠道零代码) */}
      <SchemaForm
        basePath={`channels.${channelId}`}
        fields={info.manifest.configSchema}
        values={values}
        onSave={onSave}
      />

      {/* ② 测试连接 + 渠道专属附加块(如飞书网络诊断) */}
      <div className="px-5 py-4 flex flex-col items-start gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={!info.configured || test.phase === 'testing'}
            className={BTN_SM_BLUE}
          >
            {test.phase === 'testing'
              ? t('settings.channels.testing', '测试中…')
              : t('settings.channels.testConnection', '测试连接')}
          </button>
          {test.phase !== 'idle' && test.phase !== 'testing' && (
            <span
              className={`text-[11px] ${
                test.phase === 'ok'
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : 'text-red-500 dark:text-red-400'
              }`}
            >
              {test.phase === 'ok' ? '✅ ' : '❌ '}
              {test.message}
            </span>
          )}
        </div>
        {!info.configured && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            {t('settings.channels.fillRequiredFirst', '填写并保存必填项后可测试连接')}
          </p>
        )}
        {extra}
      </div>

      {/* ③ 平台侧操作清单(建应用/开权限/发布 — WorkBuddy 式指引) */}
      {info.manifest.setupGuide && (
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            {info.manifest.setupGuide.title}
          </p>
          <ol className="list-decimal list-inside space-y-1">
            {info.manifest.setupGuide.steps.map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态安装指引步骤,不会重排
              <li key={i} className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
