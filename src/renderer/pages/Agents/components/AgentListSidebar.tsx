// =============================================================
// 左侧 Agent 列表侧栏 — 列表加载态/空态/卡片选择与启停开关
// =============================================================

import type { AgentListItem } from '@shared/types'
import { Bot } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { PageHeader } from '../../../components/PageHeader'
import { Skeleton } from '../../../components/Skeleton'
import { useT } from '../../../i18n'
import { btnStyle, CARD_INTERACTIVE } from '../../../lib/ui-utils'
import { getAgentStatusLabel, getModelTierLabel } from '../lib/agent-display'

interface AgentListSidebarProps {
  agents: AgentListItem[]
  loading: boolean
  selectedAgentId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onRefresh: () => void
}

export function AgentListSidebar({
  agents,
  loading,
  selectedAgentId,
  onSelect,
  onToggle,
  onRefresh,
}: AgentListSidebarProps) {
  const { t } = useT()

  return (
    <div className="w-80 border-r border-gray-200/60 dark:border-white/[0.06] flex flex-col bg-gray-50/50 dark:bg-surface-tertiary">
      <PageHeader
        title={t('page.agents.title')}
        size="md"
        actions={
          <button
            type="button"
            onClick={onRefresh}
            aria-label={t('common.refresh', '刷新')}
            className={btnStyle('ghost')}
          >
            {t('page.agents.refresh')}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="space-y-2.5">
            {['sk-1', 'sk-2', 'sk-3', 'sk-4'].map((sk) => (
              <div
                key={sk}
                className="px-3.5 py-3 rounded-xl border border-gray-200/70 dark:border-white/[0.06]"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton className="w-8 h-8 rounded-lg flex-shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="w-9 h-5 rounded-full flex-shrink-0" />
                </div>
                <Skeleton className="h-3 w-2/3 mt-2 ml-[42px]" />
              </div>
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Bot size={28} />}
            title={`${t('common.none')} Agent`}
            description="config/agents.yaml"
          />
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(agent.id)
                }
              }}
              role="button"
              tabIndex={0}
              className={`w-full text-left px-3.5 py-3 rounded-xl transition-all duration-200 border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50
                  ${
                    selectedAgentId === agent.id
                      ? 'bg-blue-50 dark:bg-blue-500/[0.1] border-blue-500/50 dark:border-blue-500/30 shadow-sm'
                      : CARD_INTERACTIVE
                  }`}
            >
              <div className="flex items-center gap-2.5">
                {/* 状态色 avatar: 提供视觉锚点, 弱化纯文本列表的拥挤感 */}
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                      ${
                        agent.status === 'running'
                          ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400'
                          : agent.status === 'error'
                            ? 'bg-red-100 dark:bg-red-500/15 text-red-500 dark:text-red-400'
                            : agent.enabled
                              ? 'bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500'
                      }`}
                >
                  <Bot size={16} />
                </span>
                <span className="font-medium text-sm truncate flex-1">{agent.name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={agent.enabled}
                  aria-label={
                    agent.enabled
                      ? `${t('page.agents.list.disable', '停用')} ${agent.name}`
                      : `${t('page.agents.list.enable', '启用')} ${agent.name}`
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(agent.id, !agent.enabled)
                  }}
                  className={`relative w-9 h-5 rounded-full transition-colors inline-block flex-shrink-0
                      ${agent.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform inline-block
                        ${agent.enabled ? 'left-[18px]' : 'left-0.5'}`}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1.5 pl-[42px]">
                {agent.description || agent.role}
              </p>
              <div className="flex items-center gap-2 mt-2 pl-[42px] text-[11px]">
                <span
                  className={`w-1.5 h-1.5 rounded-full inline-block
                      ${agent.status === 'running' ? 'bg-blue-400 animate-pulse' : ''}
                      ${agent.status === 'error' ? 'bg-red-400' : ''}
                      ${agent.status === 'idle' && agent.enabled ? 'bg-green-400' : ''}
                      ${agent.status === 'idle' && !agent.enabled ? 'bg-gray-300 dark:bg-gray-600' : ''}
                    `}
                />
                <span className="text-gray-400 dark:text-gray-500">
                  {getAgentStatusLabel(agent.status, agent.enabled)}
                </span>
                <span
                  className={`ml-auto px-1.5 py-px rounded-full text-[10px] font-medium
                      ${
                        agent.modelTier === 'high_quality'
                          ? 'bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400'
                          : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400'
                      }`}
                >
                  {getModelTierLabel(agent.modelTier)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
