// =============================================================
// FeishuStatusBadge — 飞书长连接机器人状态徽章行(状态点/文案/连接/断开)
// 结构自 sections/FeishuSection.tsx 逐字搬移
// =============================================================

import type { FeishuBotStatusInfo } from '@shared/types'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'

interface FeishuStatusBadgeProps {
  botStatus: FeishuBotStatusInfo | null
  hasAppId: boolean
  secretSavedToKeystore: boolean
  isConfigured: boolean
}

export function FeishuStatusBadge({
  botStatus,
  hasAppId,
  secretSavedToKeystore,
  isConfigured,
}: FeishuStatusBadgeProps) {
  const { t } = useT()
  return (
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
          ? `${t('page.settings.feishu.connected', '已连接')}${botStatus.appId ? ` · ${botStatus.appId.slice(0, 12)}...` : ''}`
          : botStatus?.status === 'connecting'
            ? t('page.settings.feishu.connecting', '连接中...')
            : botStatus?.status === 'error'
              ? `${t('page.settings.feishu.connectFailed', '连接失败')}${botStatus.error ? ` · ${botStatus.error}` : ''}`
              : !hasAppId
                ? t(
                    'page.settings.feishu.notConfigured',
                    '未配置 · 请填写 App ID 和 App Secret 并保存',
                  )
                : !secretSavedToKeystore
                  ? t(
                      'page.settings.feishu.notSaved',
                      '未保存 · 请点击下方"保存"按钮将凭证写入本地加密存储',
                    )
                  : t('page.settings.feishu.disconnected', '未连接')}
      </span>
      {botStatus?.status === 'connected' &&
        botStatus.processingCount &&
        botStatus.processingCount > 0 && (
          <span className="text-[10px] text-blue-500 dark:text-blue-400 ml-1">
            {t('status.processing', '处理中')} {botStatus.processingCount}
          </span>
        )}
      <div className="flex-1" />
      {botStatus?.status === 'connected' ? (
        <button
          type="button"
          onClick={() => getAPI().feishu.botStop()}
          className="text-[10px] px-2 py-1 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
        >
          {t('page.mcp.disconnect', '断开')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => getAPI().feishu.botStart()}
          disabled={!isConfigured}
          title={
            !hasAppId
              ? t('page.settings.feishu.appIdRequired', '请先填写 App ID')
              : !secretSavedToKeystore
                ? t(
                    'page.settings.feishu.saveSecretFirst',
                    '请先点击"保存"按钮,将 App Secret 加密存储到本地',
                  )
                : t('page.settings.feishu.startBot', '启动飞书长连接机器人')
          }
          className="text-[10px] px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t('page.mcp.connect', '连接')}
        </button>
      )}
    </div>
  )
}
