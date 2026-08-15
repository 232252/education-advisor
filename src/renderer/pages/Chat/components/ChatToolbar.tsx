// =============================================================
// 顶部工具栏 — Agent 选择器 + 模型配置 + 思考级别 + 清空按钮
// 纯 Agent 模式: 三者常驻显示
// =============================================================

import type { AgentListItem } from '@shared/types'
import { ModelSelector } from '../../../components/ModelSelector'
import { btnStyle } from '../../../lib/ui-utils'

interface ChatToolbarProps {
  /** 可用 Agent 列表（仅启用的） */
  enabledAgents: AgentListItem[]
  selectedAgentId: string
  onSelectAgent: (id: string) => void
  thinkingLevel: string
  onThinkingLevelChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  selectedProvider: string
  selectedModel: string
  onModelSelect: (provider: string, model: string) => void
  onClearMessages: () => void
}

/** 顶部工具栏（Agent / 模型 / 思考级别 常驻） */
export function ChatToolbar({
  enabledAgents,
  selectedAgentId,
  onSelectAgent,
  thinkingLevel,
  onThinkingLevelChange,
  selectedProvider,
  selectedModel,
  onModelSelect,
  onClearMessages,
}: ChatToolbarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-2 border-b border-gray-200/60 dark:border-white/[0.06] flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Agent 选择器 — 常驻显示 */}
        <select
          value={selectedAgentId}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300
                         focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent min-w-[160px] transition-colors"
          title="选择 Agent"
        >
          {enabledAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.role}
            </option>
          ))}
        </select>

        {/* 分隔线 */}
        <div className="h-4 w-px bg-gray-200 dark:bg-white/[0.08]" />

        {/* 模型配置 — 常驻显示 */}
        <ModelSelector
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          onSelect={onModelSelect}
        />

        {/* 思考级别 — 常驻显示 */}
        <select
          value={thinkingLevel}
          onChange={onThinkingLevelChange}
          className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300
                         focus:outline-none focus:border-blue-500 transition-colors"
          title="思考级别"
        >
          <option value="off">思考 关</option>
          <option value="minimal">思考 最少</option>
          <option value="low">思考 低</option>
          <option value="medium">思考 中</option>
          <option value="high">思考 高</option>
          <option value="xhigh">思考 最高</option>
        </select>
      </div>
      <button
        type="button"
        onClick={onClearMessages}
        className={btnStyle('ghost')}
        aria-label="清空当前会话显示"
        title="清空当前会话显示(不删除会话)"
      >
        清空
      </button>
    </div>
  )
}
