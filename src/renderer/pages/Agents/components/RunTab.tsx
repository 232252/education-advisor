// =============================================================
// 执行 Tab
// PERF: RunTab 直接订阅 agentStore 的 liveOutput/liveToolCalls/isRunning,
//      避免这些流式状态作为 props 传入 AgentDetailPanel 导致整面板重渲染。
//      现在只有 RunTab 在流式输出期间重渲染,ConfigTab/EditorTab/HistoryTab 不受影响。
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../../../components/Markdown'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'
import { useAgentStore } from '../../../stores/agent/store'

interface RunTabProps {
  agentId: string
  enabled: boolean
  onRun: (id: string, prompt: string) => Promise<void>
  onAbort: (id: string) => Promise<void>
}

export function RunTab({ agentId, enabled, onRun, onAbort }: RunTabProps) {
  const { t } = useT()
  // 细粒度 selector: 只订阅本 Tab 需要的流式状态
  const liveOutput = useAgentStore((s) => s.liveOutput)
  const liveToolCalls = useAgentStore((s) => s.liveToolCalls)
  const isRunning = useAgentStore((s) => s.isRunning)
  const [prompt, setPrompt] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部 — liveOutput/liveToolCalls 作为触发器，
  // 每次流式输出更新时重新执行滚动，虽然 effect body 不直接读取它们。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 触发器式 effect，依赖变化驱动滚动
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [liveOutput, liveToolCalls])

  const handleRun = () => {
    if (!prompt.trim() || isRunning) return
    onRun(agentId, prompt.trim())
  }

  return (
    <div className="h-full flex flex-col">
      {/* 输入区 */}
      <div className="p-4 border-b border-gray-200 dark:border-white/[0.06]">
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleRun()
              }
            }}
            disabled={isRunning || !enabled}
            placeholder={
              enabled
                ? t('page.agents.run.placeholder', '输入指令或问题...')
                : t('page.agents.run.disabled', 'Agent 已禁用')
            }
            className="flex-1 bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-4 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow disabled:opacity-50"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={() => onAbort(agentId)}
              aria-label={t('page.agents.run.stop', '停止执行')}
              className={btnStyle('danger')}
            >
              {t('page.agents.run.stopBtn', '停止')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!prompt.trim() || !enabled}
              aria-label={t('page.agents.run.execute', '执行')}
              className={btnStyle('primary')}
            >
              {t('page.agents.run.execute', '执行')}
            </button>
          )}
        </div>
      </div>

      {/* 输出区 */}
      <div className="flex-1 overflow-y-auto p-4" ref={outputRef}>
        {/* 工具调用记录 */}
        {liveToolCalls.length > 0 && (
          <div className="mb-4 space-y-1">
            {liveToolCalls.map((tc) => (
              // 用 tool name + args hash 组合 stable key, 避免 index 重建
              <div
                key={`${tc.name}-${tc.time}-${JSON.stringify(tc.args).slice(0, 32)}`}
                className="text-xs bg-gray-50 border border-gray-200 dark:bg-surface-elevated dark:border-white/[0.06] rounded px-3 py-1.5 font-mono"
              >
                <span className="text-blue-500 dark:text-blue-400">{tc.name}</span>
                <span className="text-gray-400 dark:text-gray-500 ml-2">
                  {JSON.stringify(tc.args)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 实时输出 — Markdown 渲染(agent 报告含标题/列表/表格) */}
        {liveOutput ? (
          <div className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
            <Markdown content={liveOutput} />
          </div>
        ) : (
          !isRunning && (
            <div className="text-gray-400 dark:text-gray-600 text-sm text-center mt-8">
              {t('page.agents.run.emptyOutput', '执行结果将在此显示')}
            </div>
          )
        )}

        {isRunning && (
          <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 animate-pulse">
            {t('page.agents.run.running', 'Agent 正在执行中...')}
          </div>
        )}
      </div>
    </div>
  )
}
