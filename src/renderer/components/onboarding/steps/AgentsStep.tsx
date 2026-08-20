// =============================================================
// AgentsStep — 引导向导第 3 步: 启用智能 Agent
// 展示 Agent 列表(默认全选);已启用的 Agent 不会重复启用。
// =============================================================

import type { AgentListItem } from '@shared/types'
import { Bot } from 'lucide-react'
import { useT } from '../../../i18n'
import { cn } from '../../../lib/ui-utils'

interface AgentsStepProps {
  agents: AgentListItem[]
  agentsLoading: boolean
  /** 当前勾选的 Agent id 集合 */
  selectedAgentIds: Set<string>
  enablingAgents: boolean
  /** 切换单个 Agent 勾选状态 */
  onToggleAgent: (id: string) => void
  /** 上一步 → 学生名单 */
  onBack: () => void
  /** 完成配置 → 启用勾选的 Agent 并进入完成页 */
  onFinish: () => void
}

export function AgentsStep({
  agents,
  agentsLoading,
  selectedAgentIds,
  enablingAgents,
  onToggleAgent,
  onBack,
  onFinish,
}: AgentsStepProps) {
  const { t } = useT()
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
        {t('onboarding.agents.title', '启用智能 Agent')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t(
          'onboarding.agents.desc',
          'Agent 负责定期分析学情、生成报告。可现在启用,稍后也可在「Agent」页调整。',
        )}
      </p>
      {agentsLoading ? (
        <div className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
          {t('common.loading', '加载中...')}
        </div>
      ) : agents.length === 0 ? (
        <div className="py-8 text-center">
          <Bot size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t('onboarding.agents.empty', '未发现可用 Agent,可稍后在「Agent」页配置')}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {agents.map((a) => {
            const checked = selectedAgentIds.has(a.id)
            return (
              <label
                key={a.id}
                className={cn(
                  'flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors',
                  checked
                    ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50/50 dark:bg-blue-500/[0.08]'
                    : 'border-gray-200/80 dark:border-white/[0.06] hover:bg-gray-50 dark:hover:bg-white/[0.03]',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleAgent(a.id)}
                  className="mt-0.5 accent-blue-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                      {a.name}
                    </span>
                    {a.enabled && (
                      <span className="text-[9px] px-1 py-px rounded bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400 font-medium">
                        {t('onboarding.agents.alreadyEnabled', '已启用')}
                      </span>
                    )}
                  </div>
                  {a.description && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                      {a.description}
                    </p>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          {t('onboarding.back', '上一步')}
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={enablingAgents}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {enablingAgents
            ? t('onboarding.agents.enabling', '启用中…')
            : t('onboarding.finish', '完成配置')}
        </button>
      </div>
    </div>
  )
}
