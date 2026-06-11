// =============================================================
// Agent 控制台页面 — 完整的 Agent 管理与执行界面
// =============================================================

import type { AgentDetail, AgentExecution } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROUTES } from '../../hooks/useNavigation'
import { useT } from '../../i18n'
// P6: 跳转到全局历史页面(集中管理路由路径)
import { getAPI } from '../../lib/ipc-client'
import { useAgentStore } from '../../stores/agentStore'

type TabKey = 'config' | 'run' | 'soul' | 'rules' | 'skills' | 'history'

export function AgentsPage() {
  const { t } = useT()
  const {
    agents,
    loading,
    selectedAgentId,
    selectedDetail,
    detailLoading,
    liveOutput,
    liveToolCalls,
    isRunning,
    fetchAgents,
    toggleAgent,
    updateAgent,
    selectAgent,
    runAgent,
    abortAgent,
    saveSoul,
    saveRules,
    initStatusListener,
  } = useAgentStore()

  useEffect(() => {
    fetchAgents()
    initStatusListener()
    return () => {
      // 清理：取消 IPC 监听，防止重复挂载导致监听器泄漏
      const unsub = useAgentStore.getState()._unsubscribeStatus
      if (unsub) unsub()
    }
  }, [fetchAgents, initStatusListener])

  return (
    <div className="h-full flex">
      {/* 左侧：Agent 列表 */}
      <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-lg font-bold">{t('page.agents.title')}</h1>
          <div className="flex items-center gap-2">
            {/* P6: 跳转到全局历史页面 */}
            <Link
              to={ROUTES.agentHistory}
              title="查看所有 Agent 的执行历史"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              历史
            </Link>
            <button
              type="button"
              onClick={fetchAgents}
              className="text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded transition-colors"
            >
              {t('page.agents.refresh')}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-8">
              {t('common.loading')}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">
              {t('common.none')} Agent
              <br />
              <span className="text-xs text-gray-400 dark:text-gray-600">config/agents.yaml</span>
            </div>
          ) : (
            agents.map((agent) => (
              <button
                type="button"
                key={agent.id}
                onClick={() => selectAgent(agent.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors border
                  ${
                    selectedAgentId === agent.id
                      ? 'bg-gray-200 dark:bg-gray-700 border-blue-500'
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{agent.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={agent.enabled}
                    aria-label={agent.enabled ? `停用 ${agent.name}` : `启用 ${agent.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleAgent(agent.id, !agent.enabled)
                    }}
                    className={`relative w-8 h-4 rounded-full transition-colors inline-block flex-shrink-0
                      ${agent.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform inline-block
                        ${agent.enabled ? 'left-4' : 'left-0.5'}`}
                    />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {agent.description || agent.role}
                </p>
                <div className="flex items-center gap-2 mt-2 text-[11px]">
                  <span
                    className={`w-1.5 h-1.5 rounded-full inline-block
                      ${agent.status === 'running' ? 'bg-blue-400 animate-pulse' : ''}
                      ${agent.status === 'error' ? 'bg-red-400' : ''}
                      ${agent.status === 'idle' && agent.enabled ? 'bg-green-400' : ''}
                      ${agent.status === 'idle' && !agent.enabled ? 'bg-gray-300 dark:bg-gray-600' : ''}
                    `}
                  />
                  <span className="text-gray-400 dark:text-gray-500">
                    {agent.status === 'running'
                      ? '运行中'
                      : agent.status === 'error'
                        ? '错误'
                        : agent.enabled
                          ? '就绪'
                          : '已停用'}
                  </span>
                  <span className="text-gray-400 dark:text-gray-600 ml-auto">
                    {agent.modelTier === 'high_quality' ? '高质量' : '低成本'}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 右侧：Agent 详情 */}
      <div className="flex-1 flex flex-col">
        {!selectedAgentId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
            选择左侧 Agent 查看详情
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
            加载中...
          </div>
        ) : selectedDetail ? (
          <AgentDetailPanel
            detail={selectedDetail}
            isRunning={isRunning}
            liveOutput={liveOutput}
            liveToolCalls={liveToolCalls}
            onRun={runAgent}
            onAbort={abortAgent}
            onSaveSoul={saveSoul}
            onSaveRules={saveRules}
            onUpdate={updateAgent}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
            加载失败
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================
// Agent 详情面板
// =============================================================

interface DetailPanelProps {
  detail: AgentDetail
  isRunning: boolean
  liveOutput: string
  liveToolCalls: Array<{ name: string; args: unknown; time: number }>
  onRun: (id: string, prompt: string) => Promise<void>
  onAbort: (id: string) => Promise<void>
  onSaveSoul: (id: string, content: string) => Promise<void>
  onSaveRules: (id: string, content: string) => Promise<void>
  onUpdate: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      modelTier: 'high_quality' | 'low_cost'
      capabilities: string[]
    }>,
  ) => Promise<void>
}

function AgentDetailPanel({
  detail,
  isRunning,
  liveOutput,
  liveToolCalls,
  onRun,
  onAbort,
  onSaveSoul,
  onSaveRules,
  onUpdate,
}: DetailPanelProps) {
  const [tab, setTab] = useState<TabKey>('run')

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'config', label: '配置' },
    { key: 'run', label: '执行' },
    { key: 'soul', label: 'SOUL.md' },
    { key: 'rules', label: 'AGENTS.md' },
    { key: 'skills', label: '绑定技能' },
    { key: 'history', label: `历史 (${detail.executionHistory.length})` },
  ]

  return (
    <>
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">{detail.name}</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              detail.status === 'running'
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                : detail.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300'
                  : detail.enabled
                    ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            {detail.status === 'running'
              ? '运行中'
              : detail.status === 'error'
                ? '错误'
                : detail.enabled
                  ? '就绪'
                  : '已停用'}
          </span>
          {!detail.enabled && (
            <span className="text-xs text-yellow-600 dark:text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded">
              已禁用
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {detail.description || detail.role}
        </p>
        <div className="flex gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
          <span>模型: {detail.modelTier === 'high_quality' ? '高质量' : '低成本'}</span>
          <span>能力: {detail.capabilities.join(', ') || '无'}</span>
          {detail.schedule.length > 0 && <span>定时: {detail.schedule.join(', ')}</span>}
        </div>
      </div>

      {/* Tab 栏 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {tabs.map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors
              ${
                tab === t.key
                  ? 'text-blue-500 dark:text-blue-400 border-b-2 border-blue-500 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'config' && <ConfigTab detail={detail} onUpdate={onUpdate} />}
        {tab === 'run' && (
          <RunTab
            agentId={detail.id}
            enabled={detail.enabled}
            isRunning={isRunning}
            liveOutput={liveOutput}
            liveToolCalls={liveToolCalls}
            onRun={onRun}
            onAbort={onAbort}
          />
        )}
        {tab === 'soul' && (
          <EditorTab
            content={detail.soulContent}
            placeholder={`你是 ${detail.name}...\n\n在此编辑 Agent 的人格设定。`}
            onSave={(c) => onSaveSoul(detail.id, c)}
          />
        )}
        {tab === 'rules' && (
          <EditorTab
            content={detail.rulesContent}
            placeholder="在此编辑 Agent 的行为规则..."
            onSave={(c) => onSaveRules(detail.id, c)}
          />
        )}
        {tab === 'skills' && <SkillsTab detail={detail} onUpdate={onUpdate} />}
        {tab === 'history' && <HistoryTab executions={detail.executionHistory} />}
      </div>
    </>
  )
}

// =============================================================
// 执行 Tab
// =============================================================

interface RunTabProps {
  agentId: string
  enabled: boolean
  isRunning: boolean
  liveOutput: string
  liveToolCalls: Array<{ name: string; args: unknown; time: number }>
  onRun: (id: string, prompt: string) => Promise<void>
  onAbort: (id: string) => Promise<void>
}

function RunTab({
  agentId,
  enabled,
  isRunning,
  liveOutput,
  liveToolCalls,
  onRun,
  onAbort,
}: RunTabProps) {
  const [prompt, setPrompt] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [])

  const handleRun = () => {
    if (!prompt.trim() || isRunning) return
    onRun(agentId, prompt.trim())
  }

  return (
    <div className="h-full flex flex-col">
      {/* 输入区 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
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
            placeholder={enabled ? '输入指令或问题...' : 'Agent 已禁用'}
            className="flex-1 bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-4 py-2 text-sm
              focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={() => onAbort(agentId)}
              className="bg-red-700 hover:bg-red-600 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!prompt.trim() || !enabled}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              执行
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
                className="text-xs bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded px-3 py-1.5 font-mono"
              >
                <span className="text-blue-500 dark:text-blue-400">{tc.name}</span>
                <span className="text-gray-400 dark:text-gray-500 ml-2">
                  {JSON.stringify(tc.args)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 实时输出 */}
        {liveOutput ? (
          <pre className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
            {liveOutput}
          </pre>
        ) : (
          !isRunning && (
            <div className="text-gray-400 dark:text-gray-600 text-sm text-center mt-8">
              执行结果将在此显示
            </div>
          )
        )}

        {isRunning && (
          <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 animate-pulse">
            Agent 正在执行中...
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================
// 编辑器 Tab
// =============================================================

interface EditorTabProps {
  content: string
  placeholder: string
  onSave: (content: string) => Promise<void>
}

function EditorTab({ content, placeholder, onSave }: EditorTabProps) {
  const [text, setText] = useState(content)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // 当切换 agent 时重置
  useEffect(() => {
    setText(content)
    setDirty(false)
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    await onSave(text)
    setSaving(false)
    setDirty(false)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40
            px-3 py-1 rounded transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        placeholder={placeholder}
        className="flex-1 w-full bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300 p-4 text-sm font-mono resize-none
          focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
      />
    </div>
  )
}

// =============================================================
// 历史 Tab
// =============================================================

function HistoryTab({ executions }: { executions: AgentExecution[] }) {
  if (executions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
        暂无执行记录
      </div>
    )
  }

  // 按时间倒序
  const sorted = [...executions].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
            <th className="text-left p-3 font-normal">时间</th>
            <th className="text-left p-3 font-normal">状态</th>
            <th className="text-left p-3 font-normal">指令</th>
            <th className="text-left p-3 font-normal">耗时</th>
            <th className="text-left p-3 font-normal">Token</th>
            <th className="text-left p-3 font-normal">费用</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((exec) => (
            <HistoryRow key={exec.id} exec={exec} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryRow({ exec }: { exec: AgentExecution }) {
  const [expanded, setExpanded] = useState(false)
  const date = new Date(exec.startedAt)
  const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
      >
        <td className="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{timeStr}</td>
        <td className="p-3">
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              exec.status === 'success'
                ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                : exec.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
                  : 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400'
            }`}
          >
            {exec.status === 'success' ? '成功' : exec.status === 'error' ? '错误' : '超时'}
          </span>
        </td>
        <td className="p-3 text-gray-600 dark:text-gray-300 truncate max-w-[200px]">
          {exec.prompt}
        </td>
        <td className="p-3 text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {(exec.durationMs / 1000).toFixed(1)}s
        </td>
        <td className="p-3 text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {exec.tokenUsage.inputTokens + exec.tokenUsage.outputTokens}
        </td>
        <td className="p-3 text-gray-400 dark:text-gray-500 whitespace-nowrap">
          ${exec.cost.toFixed(4)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-800/30">
          <td colSpan={6} className="p-4">
            <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">输入: {exec.prompt}</div>
            <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
              {exec.output}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// =============================================================
// 配置 Tab — Agent 属性编辑（调用 agent:update）
// =============================================================

interface ConfigTabProps {
  detail: AgentDetail
  onUpdate: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      modelTier: 'high_quality' | 'low_cost'
      capabilities: string[]
      skillIds: string[]
    }>,
  ) => Promise<void>
}

function ConfigTab({ detail, onUpdate }: ConfigTabProps) {
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const [modelTier, setModelTier] = useState<'high_quality' | 'low_cost'>(detail.modelTier)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // 切换 agent 时（detail 引用变化）重置表单
  // 使用 ref 模式以避免 useExhaustiveDependencies: 仅当 detail 引用实际变化时才同步
  const prevDetailRef = useRef<AgentDetail>(detail)
  useEffect(() => {
    if (prevDetailRef.current !== detail) {
      prevDetailRef.current = detail
      setName(detail.name)
      setDescription(detail.description)
      setModelTier(detail.modelTier)
      setDirty(false)
    }
  }, [detail])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(detail.id, { name, description, modelTier })
      setDirty(false)
    } catch {
      // updateAgent 内部已 toast
    } finally {
      setSaving(false)
    }
  }

  const markDirty = () => setDirty(true)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40
            px-3 py-1 rounded transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent 名称 */}
        <div>
          <label
            htmlFor="agent-config-name"
            className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1"
          >
            名称
          </label>
          <input
            id="agent-config-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty()
            }}
            className="w-full bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
              focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* 描述 */}
        <div>
          <label
            htmlFor="agent-config-description"
            className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1"
          >
            描述
          </label>
          <textarea
            id="agent-config-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              markDirty()
            }}
            rows={3}
            className="w-full bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-2 text-sm resize-none
              focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* 模型层级 */}
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">
            模型层级
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setModelTier('low_cost')
                markDirty()
              }}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                modelTier === 'low_cost'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
              }`}
            >
              低成本
            </button>
            <button
              type="button"
              onClick={() => {
                setModelTier('high_quality')
                markDirty()
              }}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                modelTier === 'high_quality'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
              }`}
            >
              高质量
            </button>
          </div>
        </div>

        {/* 只读信息 */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
          <h4 className="text-xs text-gray-400 dark:text-gray-500 font-medium">只读信息</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">ID</div>
            <div className="font-mono text-gray-700 dark:text-gray-300">{detail.id}</div>
            <div className="text-gray-500 dark:text-gray-400">角色</div>
            <div className="text-gray-700 dark:text-gray-300">{detail.role}</div>
            <div className="text-gray-500 dark:text-gray-400">能力</div>
            <div className="text-gray-700 dark:text-gray-300">
              {detail.capabilities.join(', ') || '无'}
            </div>
            <div className="text-gray-500 dark:text-gray-400">定时</div>
            <div className="font-mono text-gray-700 dark:text-gray-300">
              {detail.schedule.join(', ') || '无'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// 绑定技能 Tab — P3: 列出全部 skills, 勾选要绑定的项,保存后生效
// =============================================================

interface SkillsTabProps {
  detail: AgentDetail
  onUpdate: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      modelTier: 'high_quality' | 'low_cost'
      capabilities: string[]
      skillIds: string[]
    }>,
  ) => Promise<void>
}

interface SkillView {
  name: string
  description: string
  source: 'user' | 'project'
}

function SkillsTab({ detail, onUpdate }: SkillsTabProps) {
  const [allSkills, setAllSkills] = useState<SkillView[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // 加载全部 skills
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = (await getAPI().skill.list()) as SkillView[]
        if (cancelled) return
        setAllSkills(
          list.map((s) => ({ name: s.name, description: s.description, source: s.source })),
        )
        setLoading(false)
      } catch (err) {
        console.error('[SkillsTab] load skills failed:', err)
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 切换 agent 时,根据 detail.skillIds 同步 selected
  const prevDetailRef = useRef<AgentDetail>(detail)
  useEffect(() => {
    if (prevDetailRef.current !== detail) {
      prevDetailRef.current = detail
      if (detail.skillIds === undefined) {
        // 向后兼容:未配置时显示空勾选(代表"全部")
        setSelected(new Set())
      } else {
        setSelected(new Set(detail.skillIds))
      }
      setDirty(false)
    }
  }, [detail])

  const toggleSkill = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // P3: 必须显式传数组(空数组表示"绑定 0 个")
      // 如果用户没改过 detail.skillIds(原来是 undefined,代表"全部"),保持原语义
      const detailIds = detail.skillIds
      let payload: string[]
      if (detailIds === undefined && selected.size === 0) {
        // 全部未勾选 + 原本是"全部" → 视为空数组(不绑定任何)
        payload = []
      } else {
        payload = Array.from(selected)
      }
      await onUpdate(detail.id, { skillIds: payload })
      setDirty(false)
    } catch {
      // onUpdate 内部已 toast
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
        加载技能列表中...
      </div>
    )
  }

  if (allSkills.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
        暂无可用技能。可在 Skill 管理页面创建。
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'} · 已选 {selected.size} / {allSkills.length}
          {detail.skillIds === undefined && !dirty && (
            <span className="ml-2 text-yellow-600 dark:text-yellow-500">(默认:全部)</span>
          )}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40
            px-3 py-1 rounded transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {allSkills.map((s) => {
          const checked = selected.has(s.name)
          return (
            <label
              key={s.name}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                ${
                  checked
                    ? 'bg-blue-50 border-blue-400 dark:bg-blue-900/20 dark:border-blue-500'
                    : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleSkill(s.name)}
                className="mt-1 w-4 h-4"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-700 dark:text-gray-200 font-mono">
                    {s.name}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      s.source === 'user'
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {s.source === 'user' ? '用户' : '项目'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                  {s.description}
                </p>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}
