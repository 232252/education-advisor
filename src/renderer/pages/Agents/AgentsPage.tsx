// =============================================================
// Agent 控制台页面 — 完整的 Agent 管理与执行界面
// =============================================================

import type { AgentDetail, AgentExecution } from '@shared/types'
import { AlertTriangle, ArrowLeft, Bot, ClipboardList, Hourglass } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, CARD_INTERACTIVE, cn, TABLE_ROW, TABLE_TD, TABLE_TH } from '../../lib/ui-utils'
import { useAgentStore } from '../../stores/agentStore'

type TabKey = 'config' | 'run' | 'soul' | 'rules' | 'history'

export function AgentsPage() {
  const { t } = useT()
  // OPT-2: 使用独立 selector 避免整个 store 订阅,防止流式输出时每 token 触发全页重渲染
  // PERF: liveOutput/liveToolCalls/isRunning 不在主页面订阅,RunTab 内部直接订阅
  //       避免流式输出触发整个 AgentsPage 重渲染
  const agents = useAgentStore((s) => s.agents)
  const loading = useAgentStore((s) => s.loading)
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId)
  const selectedDetail = useAgentStore((s) => s.selectedDetail)
  const detailLoading = useAgentStore((s) => s.detailLoading)
  // actions 引用稳定,无需细粒度 selector
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const toggleAgent = useAgentStore((s) => s.toggleAgent)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const runAgent = useAgentStore((s) => s.runAgent)
  const abortAgent = useAgentStore((s) => s.abortAgent)
  const saveSoul = useAgentStore((s) => s.saveSoul)
  const saveRules = useAgentStore((s) => s.saveRules)

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  return (
    <div className="h-full flex animate-fade-in">
      {/* 左侧：Agent 列表 */}
      <div className="w-80 border-r border-gray-200/60 dark:border-white/[0.06] flex flex-col bg-gray-50/50 dark:bg-surface-tertiary">
        <PageHeader
          title={t('page.agents.title')}
          size="md"
          actions={
            <button
              type="button"
              onClick={fetchAgents}
              aria-label="刷新"
              className={btnStyle('ghost')}
            >
              {t('page.agents.refresh')}
            </button>
          }
        />

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <EmptyState icon={<Hourglass size={28} />} title={t('common.loading')} />
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
                onClick={() => selectAgent(agent.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectAgent(agent.id)
                  }
                }}
                role="button"
                tabIndex={0}
                className={`w-full text-left p-3 rounded-lg transition-all duration-200 border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50
                  ${
                    selectedAgentId === agent.id
                      ? 'bg-blue-50 dark:bg-blue-500/[0.1] border-blue-500/50 dark:border-blue-500/30'
                      : CARD_INTERACTIVE
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
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧：Agent 详情 */}
      <div className="flex-1 flex flex-col">
        {!selectedAgentId ? (
          <EmptyState icon={<ArrowLeft size={28} />} title="选择左侧 Agent 查看详情" />
        ) : detailLoading ? (
          <EmptyState icon={<Hourglass size={28} />} title="加载中..." />
        ) : selectedDetail ? (
          <AgentDetailPanel
            detail={selectedDetail}
            onRun={runAgent}
            onAbort={abortAgent}
            onSaveSoul={saveSoul}
            onSaveRules={saveRules}
            onUpdate={updateAgent}
          />
        ) : (
          <EmptyState icon={<AlertTriangle size={28} />} title="加载失败" />
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
      mcpServers: string[]
    }>,
  ) => Promise<void>
}

const AgentDetailPanel = memo(function AgentDetailPanel({
  detail,
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
    { key: 'history', label: `历史 (${detail.executionHistory.length})` },
  ]

  return (
    <>
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200 dark:border-white/[0.06]">
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
      <div className="flex border-b border-gray-200 dark:border-white/[0.06]">
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
          <RunTab agentId={detail.id} enabled={detail.enabled} onRun={onRun} onAbort={onAbort} />
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
        {tab === 'history' && <HistoryTab executions={detail.executionHistory} />}
      </div>
    </>
  )
})

// =============================================================
// 执行 Tab
// PERF: RunTab 直接订阅 agentStore 的 liveOutput/liveToolCalls/isRunning,
//      避免这些流式状态作为 props 传入 AgentDetailPanel 导致整面板重渲染。
//      现在只有 RunTab 在流式输出期间重渲染,ConfigTab/EditorTab/HistoryTab 不受影响。
// =============================================================

interface RunTabProps {
  agentId: string
  enabled: boolean
  onRun: (id: string, prompt: string) => Promise<void>
  onAbort: (id: string) => Promise<void>
}

function RunTab({ agentId, enabled, onRun, onAbort }: RunTabProps) {
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
            placeholder={enabled ? '输入指令或问题...' : 'Agent 已禁用'}
            className="flex-1 bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-4 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow disabled:opacity-50"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={() => onAbort(agentId)}
              aria-label="停止执行"
              className={btnStyle('danger')}
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!prompt.trim() || !enabled}
              aria-label="执行"
              className={btnStyle('primary')}
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
    try {
      await onSave(text)
      setDirty(false)
    } catch (err) {
      // H-4 修复: 保存失败时不能让 saving 永久卡住
      console.warn('[AgentsPage] EditorTab save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={btnStyle('secondary')}
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
        className="flex-1 w-full bg-white text-gray-700 dark:bg-surface-tertiary dark:text-gray-300 p-4 text-sm font-mono resize-none
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
    return <EmptyState icon={<ClipboardList size={28} />} title="暂无执行记录" />
  }

  // 按时间倒序
  const sorted = [...executions].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={TABLE_TH}>时间</th>
            <th className={TABLE_TH}>状态</th>
            <th className={TABLE_TH}>指令</th>
            <th className={TABLE_TH}>耗时</th>
            <th className={TABLE_TH}>Token</th>
            <th className={TABLE_TH}>费用</th>
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

const HistoryRow = memo(function HistoryRow({ exec }: { exec: AgentExecution }) {
  const [expanded, setExpanded] = useState(false)
  const date = new Date(exec.startedAt)
  const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} className={cn(TABLE_ROW, 'cursor-pointer')}>
        <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400 whitespace-nowrap')}>
          {timeStr}
        </td>
        <td className={TABLE_TD}>
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
        <td className={cn(TABLE_TD, 'text-gray-600 dark:text-gray-300 truncate max-w-[200px]')}>
          {exec.prompt}
        </td>
        <td className={cn(TABLE_TD, 'text-gray-400 dark:text-gray-500 whitespace-nowrap')}>
          {(exec.durationMs / 1000).toFixed(1)}s
        </td>
        <td className={cn(TABLE_TD, 'text-gray-400 dark:text-gray-500 whitespace-nowrap')}>
          {exec.tokenUsage.inputTokens + exec.tokenUsage.outputTokens}
        </td>
        <td className={cn(TABLE_TD, 'text-gray-400 dark:text-gray-500 whitespace-nowrap')}>
          ${exec.cost.toFixed(4)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-white/[0.03]">
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
})

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
      mcpServers: string[]
    }>,
  ) => Promise<void>
}

function ConfigTab({ detail, onUpdate }: ConfigTabProps) {
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const [modelTier, setModelTier] = useState<'high_quality' | 'low_cost'>(detail.modelTier)
  // R6-2: agent 级 MCP server 引用(多选)。detail.mcpServers 可能为 undefined。
  const [mcpServers, setMcpServers] = useState<string[]>(detail.mcpServers ?? [])
  // 可用的 MCP server 列表(从 mcp:list 拉取,供用户勾选)
  const [availableServers, setAvailableServers] = useState<{ id: string; name: string }[]>([])
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
      setMcpServers(detail.mcpServers ?? [])
      setDirty(false)
    }
  }, [detail])

  // R6-2: 拉取可用 MCP server 列表(进入 config tab 时)。
  // 失败则空列表(只显示已选)。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await getAPI().mcp.list()
        if (!cancelled && result?.success && Array.isArray(result.servers)) {
          setAvailableServers(result.servers.map((s) => ({ id: s.id, name: s.name })))
        }
      } catch {
        // MCP 未启用或 IPC 不可用,availableServers 保持空,用户仍可看到已选 id
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(detail.id, { name, description, modelTier, mcpServers })
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
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={btnStyle('primary')}
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
            className="w-full bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
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
            className="w-full bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm resize-none
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
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
                  : 'bg-white dark:bg-surface-elevated text-gray-600 dark:text-gray-300 border-gray-300 dark:border-white/[0.08] hover:border-blue-400'
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
                  : 'bg-white dark:bg-surface-elevated text-gray-600 dark:text-gray-300 border-gray-300 dark:border-white/[0.08] hover:border-blue-400'
              }`}
            >
              高质量
            </button>
          </div>
        </div>

        {/* MCP server 选择 */}
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">
            MCP 服务器
          </span>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
            勾选后,该 Agent 运行时可使用这些 MCP 服务器提供的工具。在「技能 → MCP 服务器」管理。
          </p>
          {availableServers.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              {mcpServers.length === 0
                ? '暂无可用的 MCP 服务器(请在技能页添加,或未启用 MCP 功能)'
                : `已选: ${mcpServers.join(', ')} (服务列表加载中或 MCP 未启用)`}
            </p>
          ) : (
            <div className="space-y-1">
              {availableServers.map((srv) => {
                const checked = mcpServers.includes(srv.id)
                return (
                  <label
                    key={srv.id}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setMcpServers((prev) =>
                          e.target.checked ? [...prev, srv.id] : prev.filter((id) => id !== srv.id),
                        )
                        markDirty()
                      }}
                    />
                    <span className="font-mono text-xs text-blue-500">{srv.id}</span>
                    <span className="text-gray-400 dark:text-gray-500">— {srv.name}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* 只读信息 */}
        <div className="border-t border-gray-200 dark:border-white/[0.06] pt-4 space-y-2">
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
