// =============================================================
// AgentStatusBar — 侧边栏底部的 Agent 运行状态列表(M22 从 MainLayout 抽出)
// 展开态: 标题 + 运行计数徽章 + 名称列表; 折叠态: 仅状态点列
// =============================================================

import type { AgentListItem } from '@shared/types'
import { useT } from '../i18n'
import { cn } from '../lib/ui-utils'

interface AgentStatusBarProps {
  agents: AgentListItem[]
  collapsed: boolean
}

export function AgentStatusBar({ agents, collapsed }: AgentStatusBarProps) {
  const { t } = useT()
  const runningCount = agents.filter((a) => a.status === 'running').length

  return (
    <div
      className={cn(
        'border-t border-gray-200/60 dark:border-white/[0.06]',
        collapsed ? 'px-2 py-3' : 'px-4 py-3',
      )}
    >
      {!collapsed && (
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest font-semibold">
            {t('sidebar.agents', 'Agents')}
          </span>
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded-full ring-1 ring-blue-500/20">
              <span className="w-1 h-1 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
              {runningCount} {t('sidebar.running', '运行中')}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'max-h-28 overflow-y-auto',
          collapsed ? 'space-y-2 flex flex-col items-center' : 'space-y-1.5',
        )}
      >
        {/* R2-15: 此前 slice(0,6) 截断 12/18 个 agent;展开态全量(容器本身可滚动),
            折叠态最多 6 点 + 「+N」角标 */}
        {collapsed
          ? agents.slice(0, 6).map((a) => <Dot key={a.id} agent={a} collapsed />)
          : agents.map((a) => <Dot key={a.id} agent={a} collapsed={false} />)}
        {collapsed && agents.length > 6 && (
          <span
            className="text-[9px] text-gray-400 dark:text-gray-500"
            title={`其余 ${agents.length - 6} 个`}
          >
            +{agents.length - 6}
          </span>
        )}
      </div>
    </div>
  )
}

/** 单个 agent 状态点(展开态带名称;折叠态仅点) */
function Dot({ agent, collapsed }: { agent: AgentListItem; collapsed: boolean }) {
  return (
    <div
      className={cn('flex items-center text-xs', collapsed ? 'flex-col' : 'gap-2.5 group')}
      title={collapsed ? `${agent.name} · ${agent.status}` : agent.name}
    >
      <span
        className={cn(
          'rounded-full flex-shrink-0 transition-all duration-300',
          collapsed ? 'w-2 h-2' : 'w-1.5 h-1.5',
          agent.status === 'running' &&
            'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.6)] animate-pulse',
          agent.status === 'error' && 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]',
          agent.status === 'idle' && 'bg-gray-300 dark:bg-gray-600',
        )}
      />
      {!collapsed && (
        <span className="text-gray-500 dark:text-gray-400 truncate group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-150">
          {agent.name}
        </span>
      )}
    </div>
  )
}
