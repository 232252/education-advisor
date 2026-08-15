// =============================================================
// AI 分析选项卡
// 选择/运行 Agent,展示流式输出与分节结果
// =============================================================

import type { AgentListItem } from '@shared/types'
import { Bot } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { btnStyle, CARD_BASE, cn } from '../../../lib/ui-utils'

export function AIAnalysisTab({
  agents,
  selectedAgents,
  onToggleAgent,
  onRunSelected,
  onRunAll,
  running,
  output,
  message,
  aiSaved,
  onSaveResult,
}: {
  agents: AgentListItem[]
  selectedAgents: Set<string>
  onToggleAgent: (id: string) => void
  onRunSelected: () => void
  onRunAll: () => void
  running: boolean
  output: string
  message: string
  aiSaved: boolean
  onSaveResult: () => void
}) {
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  const sections = useMemo(() => {
    if (!output) return []
    const result: { title: string; content: string }[] = []
    const lines = output.split('\n')
    let currentTitle = '分析输出'
    let currentContent = ''
    for (const line of lines) {
      if (
        line.match(/^(===\s*|##\s*|【.+】)/) ||
        line.includes('操行总结') ||
        line.includes('风险预警') ||
        line.includes('行为模式') ||
        line.includes('教育建议')
      ) {
        if (currentContent.trim()) {
          result.push({ title: currentTitle, content: currentContent.trim() })
        }
        currentTitle = line
          .replace(/^[=\-#\s【】]+/g, '')
          .replace(/[\s=]+$/g, '')
          .trim()
        currentContent = ''
      } else {
        currentContent += `${line}\n`
      }
    }
    if (currentContent.trim()) {
      result.push({ title: currentTitle, content: currentContent.trim() })
    }
    return result.length > 0 ? result : [{ title: '分析输出', content: output }]
  }, [output])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">AI 分析</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRunSelected}
            disabled={running || selectedAgents.size === 0}
            className={btnStyle('primary')}
          >
            {running ? '运行中...' : `🚀 运行选中 (${selectedAgents.size})`}
          </button>
          <button
            type="button"
            onClick={onRunAll}
            disabled={running || enabledAgents.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-[#0f1117] disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white focus-visible:ring-purple-500 active:scale-[0.97]"
          >
            🤖 运行全部
          </button>
          {output && !running && (
            <button
              type="button"
              onClick={onSaveResult}
              className={cn(
                btnStyle(aiSaved ? 'secondary' : 'ghost'),
                aiSaved && 'text-green-600 dark:text-green-400',
              )}
            >
              {aiSaved ? '✅ 已保存' : '💾 保存结果'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`text-xs ${message.includes('失败') ? 'text-red-500' : 'text-green-500'}`}>
          {message}
        </div>
      )}

      <div className={`${CARD_BASE} p-4 shadow-sm`}>
        <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          选择分析 Agent
        </h5>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {enabledAgents.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="暂无可用 Agent"
              className="py-4"
            />
          ) : (
            enabledAgents.map((agent) => (
              <div
                key={agent.id}
                role="button"
                tabIndex={0}
                onClick={() => onToggleAgent(agent.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggleAgent(agent.id)
                  }
                }}
                className={
                  'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ' +
                  (selectedAgents.has(agent.id)
                    ? 'bg-blue-500/10 border border-blue-500/30'
                    : 'hover:bg-gray-50 dark:hover:bg-white/[0.06] border border-transparent')
                }
              >
                <input
                  type="checkbox"
                  checked={selectedAgents.has(agent.id)}
                  onChange={() => {}}
                  className="rounded accent-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{agent.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {agent.description}
                  </div>
                </div>
                <span
                  className={
                    'text-[10px] px-2 py-0.5 rounded-full ' +
                    (agent.status === 'idle'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                      : agent.status === 'running'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400')
                  }
                >
                  {agent.status === 'idle'
                    ? '待机'
                    : agent.status === 'running'
                      ? '运行中'
                      : '错误'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {output && (
        <div className="space-y-3">
          {sections.map((section) => (
            <div key={section.title} className={`${CARD_BASE} shadow-sm overflow-hidden`}>
              <div className="px-4 py-2.5 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-100 dark:border-white/[0.06]">
                <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  {section.title}
                </h5>
              </div>
              <div className="p-4">
                <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {section.content}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-800/50 dark:to-blue-900/10 rounded-xl border border-gray-200 dark:border-white/[0.06] p-4">
        <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          📋 分析维度建议
        </h5>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>操行分数趋势分析
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>风险等级评估与预警
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>行为模式识别
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>学业与操行关联性分析
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>个性化教育建议
          </div>
        </div>
      </div>
    </div>
  )
}
