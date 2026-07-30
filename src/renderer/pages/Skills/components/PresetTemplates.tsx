import type { McpServerConfig } from '@shared/types'
import { useId } from 'react'
import { useT } from '../../../i18n'
import { MCP_PRESETS } from '../mcp-presets'

interface PresetTemplatesProps {
  onSelect: (config: McpServerConfig) => void
  onCancel: () => void
}

export function PresetTemplates({ onSelect, onCancel }: PresetTemplatesProps) {
  const { t } = useT()
  const titleId = useId()

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-surface-tertiary rounded-lg p-6 w-full max-w-md"
      >
        <h2 id={titleId} className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">
          {t('page.mcp.preset.title')}
        </h2>
        <ul className="space-y-2">
          {MCP_PRESETS.map((preset) => {
            // 深拷贝 config 避免污染常量
            const config: McpServerConfig = JSON.parse(JSON.stringify(preset.config))
            return (
              <li key={preset.i18nSuffix}>
                <button
                  type="button"
                  onClick={() => onSelect(config)}
                  className="w-full text-left p-3 border border-gray-200 dark:border-white/[0.06] rounded hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {t(`page.mcp.preset.${preset.i18nSuffix}`)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t(`page.mcp.preset.${preset.i18nSuffix}.desc`)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1 font-mono">
                    {config.transport === 'stdio'
                      ? `${config.command} ${(config.args || []).join(' ')}`
                      : config.url}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
