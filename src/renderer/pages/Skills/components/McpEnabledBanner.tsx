// =============================================================
// McpEnabledBanner — MCP 功能开关横幅
// 结构自 tabs/McpTab.tsx 逐字搬移
// =============================================================

import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'

interface McpEnabledBannerProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

export function McpEnabledBanner({ enabled, onToggle }: McpEnabledBannerProps) {
  const { t } = useT()
  return (
    <div
      className={`px-4 py-2.5 flex items-center justify-between border-b ${
        enabled
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">
          {enabled ? (
            <>
              <span className="text-green-600 dark:text-green-400 font-medium">
                ● {t('page.mcp.banner.enabled')}
              </span>
              <span className="text-gray-600 dark:text-gray-400 ml-2">
                Model Context Protocol — {t('page.mcp.empty.hint')}
              </span>
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              ○ {t('page.mcp.banner.disabled')}
            </span>
          )}
        </span>
      </div>
      <Button
        variant={enabled ? 'secondary' : 'primary'}
        size="sm"
        onClick={() => onToggle(!enabled)}
      >
        {enabled ? t('page.mcp.disable') : t('page.mcp.enable')}
      </Button>
    </div>
  )
}
