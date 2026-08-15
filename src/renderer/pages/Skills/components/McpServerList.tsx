// =============================================================
// McpServerList — 左侧 MCP 服务器列表(添加/模板按钮 + 列表)
// 结构自 tabs/McpTab.tsx 逐字搬移
// =============================================================

import type { McpServerStatus } from '@shared/types'
import { useT } from '../../../i18n'

interface McpServerListProps {
  servers: McpServerStatus[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onFromTemplate: () => void
}

export function McpServerList({
  servers,
  selectedId,
  onSelect,
  onAdd,
  onFromTemplate,
}: McpServerListProps) {
  const { t } = useT()
  return (
    <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-white/[0.06] flex flex-col bg-gray-50/30 dark:bg-surface-tertiary/30">
      <div className="p-3 border-b border-gray-200 dark:border-white/[0.06] space-y-2">
        <button
          type="button"
          onClick={onAdd}
          className="w-full px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600"
        >
          + {t('page.mcp.add')}
        </button>
        <button
          type="button"
          onClick={onFromTemplate}
          className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06]"
        >
          ⚡ {t('page.mcp.addFromTemplate')}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {servers.length === 0 ? (
          // 左侧列表空时仅显示紧凑提示,完整空状态由右侧详情区展示(避免双份)
          <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
            {t('page.mcp.empty.title')}
          </div>
        ) : (
          <ul>
            {servers.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-white/[0.04] hover:bg-gray-100 dark:hover:bg-white/[0.04] ${
                    selectedId === s.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        s.connected ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {s.name}
                    </span>
                  </div>
                  <div className="ml-3.5 text-xs text-gray-500 dark:text-gray-400">
                    {t(`page.mcp.transport.${s.transport}`)} ·{' '}
                    {s.connected
                      ? `${s.toolCount} ${t('page.mcp.tools')}`
                      : t('page.mcp.status.disconnected')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
