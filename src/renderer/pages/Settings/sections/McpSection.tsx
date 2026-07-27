// =============================================================
// MCP 设置 Section — Model Context Protocol 功能开关 (feature flag)
// education-advisor 特有: 控制全局 MCP 集成的启用/禁用,关闭后 McpService 进入 no-op 模式
// 与 Skills/McpTab 中的开关共用 settings.mcp.enabled,任一处切换均同步生效
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useT } from '../../../i18n'
import { Section, SettingRow, ToggleSwitch } from '../components'

export interface McpSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function McpSection({ settings, onSave }: McpSectionProps) {
  const { t } = useT()

  return (
    <Section title={t('settings.section.mcp')}>
      <SettingRow
        label={t('settings.mcp.enabled')}
        path="mcp.enabled"
        description={t('settings.mcp.enabled.desc')}
      >
        <ToggleSwitch
          checked={settings.mcp.enabled}
          onChange={(v) => onSave('mcp.enabled', v)}
          label={t('settings.mcp.enabled')}
        />
      </SettingRow>
      <div className="px-5 py-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 bg-blue-50/50 dark:bg-blue-900/10 border-t border-gray-200 dark:border-white/[0.06]/60">
        <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">
          {t('settings.mcp.hint.title')}
        </div>
        {t('settings.mcp.hint.body')}
      </div>
    </Section>
  )
}
