// =============================================================
// BitableAdvancedSection — 飞书高级配置折叠块(Bitable 同步相关)
// 结构自 sections/FeishuSection.tsx 逐字搬移
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { cn, INPUT_SM } from '../../../lib/ui-utils'
import { type BitListAction, type BitListStatus, useBitableList } from '../hooks/useBitableList'
import { SettingRow } from './SettingRow'
import { ToggleSwitch } from './ToggleSwitch'

interface BitableAdvancedSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
  bitableAppToken: string
  setBitableAppToken: (s: string) => void
  bitableListStatus: BitListStatus
  dispatchBitList: (action: BitListAction) => void
  bitableListInfo: string
  setBitableListInfo: (s: string) => void
}

export function BitableAdvancedSection({
  settings,
  onSave,
  bitableAppToken,
  setBitableAppToken,
  bitableListStatus,
  dispatchBitList,
  bitableListInfo,
  setBitableListInfo,
}: BitableAdvancedSectionProps) {
  const handleListBitable = useBitableList({
    appId: settings.feishu.appId,
    bitableAppToken,
    dispatchBitList,
    setBitableListInfo,
  })

  return (
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
              onClick={handleListBitable}
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
          label="Bitable 表 ID"
          path="feishu.bitableTableId"
          description="同步目标表的 table_id(在多维表格 URL 中可找到,如 tblXXXXXXXX)。留空则用默认表 'log'"
        >
          <input
            type="text"
            value={settings.feishu.bitableTableId ?? ''}
            placeholder="tblXXXXXXXX(留空用 log)"
            onChange={(e) => onSave('feishu.bitableTableId', e.target.value)}
            className={cn(INPUT_SM, 'w-48')}
            disabled={!settings.feishu.bitableSync.enabled}
          />
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
  )
}
