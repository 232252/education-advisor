// =============================================================
// 对话页面 — 支持模型选择、流式对话、Agent 双模式切换
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { ModelSelector } from '../../components/ModelSelector'
import { PrivacyFilteredText } from '../../components/PrivacyFilteredText'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { useAgentStore } from '../../stores/agentStore'
import { useChatStore } from '../../stores/chatStore'
import { toast } from '../../stores/toastStore'

export function ChatPage() {
  const { t } = useT()
  const [input, setInput] = useState('')
  const [toolbarTab, setToolbarTab] = useState<'chat' | 'model'>('chat')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const currentProvider = useChatStore((s) => s.currentProvider)
  const currentModel = useChatStore((s) => s.currentModel)
  const currentModelContext = useChatStore((s) => s.currentModelContext)
  const currentModelMaxOutput = useChatStore((s) => s.currentModelMaxOutput)
  const lastUsage = useChatStore((s) => s.lastUsage)
  const lastCost = useChatStore((s) => s.lastCost)
  const thinkingLevel = useChatStore((s) => s.thinkingLevel)
  const sessionId = useChatStore((s) => s.sessionId)
  const sessions = useChatStore((s) => s.sessions)
  const selectedAgentId = useChatStore((s) => s.selectedAgentId)
  const handleStreamEvent = useChatStore((s) => s.handleStreamEvent)
  const handleAgentEvent = useChatStore((s) => s.handleAgentEvent)
  const setModel = useChatStore((s) => s.setModel)
  const setThinkingLevel = useChatStore((s) => s.setThinkingLevel)
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const loadHistory = useChatStore((s) => s.loadHistory)
  const createSession = useChatStore((s) => s.createSession)
  const switchSession = useChatStore((s) => s.switchSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const loadSessions = useChatStore((s) => s.loadSessions)

  // Agent 列表（从 agentStore 获取）
  const agents = useAgentStore((s) => s.agents)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)

  // 加载 agent 列表时自动选中第一个可用 agent（如教育参谋）
  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  useEffect(() => {
    const enabledAgents = agents.filter((a) => a.enabled)
    if (!selectedAgentId && enabledAgents.length > 0) {
      setSelectedAgent(enabledAgents[0].id)
    }
  }, [agents, selectedAgentId, setSelectedAgent])

  // 订阅流式事件（直接对话模式 — 使用 ref 保证稳定引用）
  const streamHandlerRef = useRef(handleStreamEvent)
  streamHandlerRef.current = handleStreamEvent

  useEffect(() => {
    const unsub = getAPI().ai.onStream((event) => streamHandlerRef.current(event))
    return unsub
  }, [])

  // 订阅 Agent 状态事件（始终接收，桥接到 chatStore）
  // 修复双重订阅：不再独立调用 getAPI().agent.onStatusUpdate。
  // agentStore 才是 IPC_AGENT_STATUS_UPDATE 的唯一主订阅者（由 MainLayout 启动），
  // ChatPage 通过 useAgentStore.subscribeStatus 拿派生订阅。
  // handleAgentEvent 是稳定函数，通过 useRef 保持引用以避免 effect 重跑。
  const agentHandlerRef = useRef(handleAgentEvent)
  agentHandlerRef.current = handleAgentEvent

  useEffect(() => {
    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      agentHandlerRef.current(data as Parameters<typeof handleAgentEvent>[0])
    })
    return unsub
  }, [])

  // 加载会话列表和历史消息
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // 启动时从 settings 拉一次当前模型(provider+model+contextWindow)
  // 修复 Bug-1: 之前 currentProvider/currentModel 是空串, 状态条永远显示"未设置"
  useEffect(() => {
    useChatStore.getState().initFromSettings()
  }, [])

  // 自动滚动到底部（新消息或流式输出时触发）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 触发器式 effect，仅依赖消息变化来执行滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  const handleModelSelect = async (provider: string, model: string) => {
    setModel(provider, model)
    try {
      await getAPI().settings.set('models.defaultProvider', provider)
      await getAPI().settings.set('models.highQualityModel', model)
    } catch {
      /* silent */
    }
  }

  const handleThinkingLevelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setThinkingLevel(value)
    try {
      await getAPI().settings.set('chat.maxTokens', value)
    } catch {
      /* silent */
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return

    const text = input.trim()
    setInput('')

    if (!selectedAgentId) {
      toast.warning('请先选择一个 Agent')
      return
    }

    // 在添加新消息之前，抓取现有对话历史（用于传给 Agent 做上下文）
    const currentMessages = useChatStore.getState().messages
    const history = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // 添加用户消息
    useChatStore.getState().addMessage({
      role: 'user',
      content: text,
      timestamp: Date.now(),
    })

    // 启动 Agent（fire-and-forget，事件通过 onStatusUpdate 桥接）
    // 传入对话历史，让 Agent 拥有完整上下文
    try {
      await getAPI().agent.runManual(selectedAgentId, text, history)
    } catch (err) {
      console.error('[Chat] Agent run failed:', err)
      toast.error('启动 Agent 失败')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasAgent = selectedAgentId
  const canSend = !!hasAgent

  // 可用的 Agent 列表（仅启用的）
  const enabledAgents = agents.filter((a) => a.enabled)

  // 停止按钮的处理
  const handleStop = () => {
    if (selectedAgentId) {
      getAPI().agent.abort(selectedAgentId)
      useChatStore.setState({ isStreaming: false })
    }
  }

  // 格式化时间
  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="flex h-full">
      {/* 左侧会话列表 */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50/50 dark:bg-gray-800/50">
        {/* 顶部操作区 */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => createSession()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + {t('page.chat.newConversation')}
          </button>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-8">
              {t('page.chat.empty.title')}
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                  ${
                    session.id === sessionId
                      ? 'bg-blue-600/20 border border-blue-500/40'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-transparent'
                  }`}
              >
                <button
                  type="button"
                  onClick={() => switchSession(session.id)}
                  className="flex-1 min-w-0 text-left bg-transparent"
                >
                  <div className="text-sm font-medium truncate dark:text-gray-200">
                    {session.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                    <span>{formatTime(session.createdAt)}</span>
                    <span>·</span>
                    <span>
                      {session.messageCount} {t('common.info')}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`${t('common.delete')}?`)) deleteSession(session.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 ml-2 text-gray-400 hover:text-red-500 transition-all text-xs"
                  title={t('common.delete')}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 主对话区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-gray-200 dark:border-gray-700/50">
          <div className="flex items-center gap-3">
            {/* 模式切换：对话（Agent）/ 模型 */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setToolbarTab('chat')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  toolbarTab === 'chat'
                    ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                对话
              </button>
              <button
                type="button"
                onClick={() => setToolbarTab('model')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  toolbarTab === 'model'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                模型
              </button>
            </div>

            {toolbarTab === 'chat' ? (
              /* Agent 选择器 */
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300
                           focus:outline-none focus:border-purple-500 min-w-[160px]"
              >
                {enabledAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                  </option>
                ))}
              </select>
            ) : (
              /* 模型配置 */
              <>
                <ModelSelector
                  selectedProvider={currentProvider}
                  selectedModel={currentModel}
                  onSelect={handleModelSelect}
                />
                <select
                  value={thinkingLevel}
                  onChange={handleThinkingLevelChange}
                  className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="off">思考 关</option>
                  <option value="minimal">思考 最少</option>
                  <option value="low">思考 低</option>
                  <option value="medium">思考 中</option>
                  <option value="high">思考 高</option>
                  <option value="xhigh">思考 最高</option>
                </select>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={clearMessages}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {t('common.delete')}
          </button>
        </div>

        {/* 上下文状态条 - 显示当前模型 contextWindow / 已用 token / 压缩进度 */}
        <ContextStatusBar
          modelContext={currentModelContext}
          modelMaxOutput={currentModelMaxOutput}
          lastUsage={lastUsage}
          lastCost={lastCost}
        />

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
              <div className="text-center">
                <div className="text-4xl mb-4">💬</div>
                <div className="text-lg">开始对话</div>
                <div className="text-sm mt-2">
                  {canSend ? '输入消息即可开始' : '请先选择一个 Agent'}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            // P2-7: 组合 stable key (role + 索引 + content 前 16 字符哈希)
            // 优先用 msg.id/timestamp,缺失时降级到组合 key
            <div
              key={
                (msg as { id?: string }).id
                  ? `${(msg as { id?: string }).id}`
                  : `${msg.role}-${i}-${msg.content.slice(0, 16)}`
              }
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                  ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100 rounded-bl-md border border-gray-200 dark:border-gray-700'
                  }`}
              >
                {/* 工具调用（放顶部） */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {msg.toolCalls.map((tc) => (
                      <div
                        key={tc.id}
                        className="text-xs bg-blue-100/50 dark:bg-blue-900/30 rounded px-2 py-1 font-mono"
                      >
                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                          {tc.name}
                        </span>
                        {tc.args && Object.keys(tc.args).length > 0 && (
                          <span className="text-gray-500 dark:text-gray-400 ml-1">
                            {JSON.stringify(tc.args)}
                          </span>
                        )}
                        {tc.result && (
                          <span
                            className={`ml-1 ${tc.isError ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400'}`}
                          >
                            {tc.isError ? '✗' : '✓'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* 思考过程 */}
                {msg.thinking && (
                  <details className="mb-2">
                    <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                      思考过程
                    </summary>
                    <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 whitespace-pre-wrap pl-2 border-l border-gray-300 dark:border-gray-700">
                      {msg.thinking}
                    </div>
                  </details>
                )}
                {/* 消息内容（放底部） */}
                <div className="whitespace-pre-wrap">
                  <PrivacyFilteredText
                    text={msg.content}
                    bypass={isStreaming && i === messages.length - 1}
                  />
                  {!msg.content &&
                    (isStreaming && i === messages.length - 1 ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse [animation-delay:0.4s]" />
                      </span>
                    ) : (
                      ''
                    ))}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          {!canSend && (
            <div className="text-xs text-amber-500 dark:text-amber-400 mb-2 text-center">
              正在加载 Agent 列表...
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1 flex items-end gap-2 bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-xl px-3 py-2 focus-within:border-blue-500 dark:focus-within:border-blue-400 transition-colors">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = (await getAPI().sys.openDialog({
                      properties: ['openFile'],
                      filters: [{ name: '所有文件', extensions: ['*'] }],
                    })) as { canceled: boolean; filePaths: string[] }
                    if (!result.canceled && result.filePaths.length > 0) {
                      const fileName =
                        result.filePaths[0].split(/[/\\]/).pop() || result.filePaths[0]
                      setInput((prev) => `${prev}[文件: ${fileName}](${result.filePaths[0]}) `)
                      toast.success(`已选择: ${fileName}`)
                    }
                  } catch {
                    toast.error('选择文件失败')
                  }
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0 p-1"
                title="上传文件"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-5 h-5"
                  role="img"
                  aria-label="上传文件"
                >
                  <title>上传文件</title>
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  canSend
                    ? `向 ${enabledAgents.find((a) => a.id === selectedAgentId)?.name ?? 'Agent'} 发送指令... (Enter 发送)`
                    : '正在加载...'
                }
                rows={1}
                className="flex-1 bg-transparent border-0 text-sm focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 resize-none max-h-32 overflow-y-auto py-1"
                disabled={isStreaming || !canSend}
              />
            </div>
            <button
              type="button"
              onClick={isStreaming ? handleStop : handleSend}
              className={`px-6 py-3 rounded-xl text-sm font-medium transition-colors self-end
                ${
                  isStreaming
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50'
                }`}
              disabled={!isStreaming && (!input.trim() || !canSend)}
            >
              {isStreaming ? '停止' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 上下文状态条 — 显示模型 contextWindow / 已用 token / 压缩阈值进度
 * 修复 Bug-1: 真正显示用户设置的 contextWindow (从 ai.listModels 拉的),
 *              不在 UI 硬编码 900K
 */
interface ContextStatusBarProps {
  modelContext: number
  modelMaxOutput: number
  lastUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  } | null
  lastCost: number
}

function ContextStatusBar({
  modelContext,
  modelMaxOutput,
  lastUsage,
  lastCost,
}: ContextStatusBarProps) {
  // 压缩阈值(默认 90% = reserve 10%) — 跟主进程 compaction-helper 自适应策略一致
  const reserve = modelContext > 0 ? Math.max(4096, Math.floor(modelContext * 0.1)) : 0
  const threshold = modelContext - reserve
  const used = lastUsage
    ? (lastUsage.inputTokens ?? 0) +
      (lastUsage.outputTokens ?? 0) +
      (lastUsage.cacheReadTokens ?? 0)
    : 0
  const pct = modelContext > 0 ? Math.min(100, (used / modelContext) * 100) : 0
  const thresholdPct = modelContext > 0 ? (threshold / modelContext) * 100 : 90
  // 颜色: <60% 绿, 60-90% 黄, >90% 红(即将压缩)
  const barColor = pct < 60 ? 'bg-green-500' : pct < thresholdPct ? 'bg-yellow-500' : 'bg-red-500'
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `${n}`)
  return (
    <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30">
      <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-700 dark:text-gray-300">上下文</span>
          <span className="font-mono">{modelContext > 0 ? `${fmtK(modelContext)}` : '未设置'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>输出上限</span>
          <span className="font-mono">{modelMaxOutput > 0 ? fmtK(modelMaxOutput) : '4K'}</span>
        </div>
        {lastUsage && (
          <>
            <div className="flex items-center gap-1.5">
              <span>已用</span>
              <span className="font-mono">
                {fmtK(used)} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>输入</span>
              <span className="font-mono">{fmtK(lastUsage.inputTokens ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>输出</span>
              <span className="font-mono">{fmtK(lastUsage.outputTokens ?? 0)}</span>
            </div>
            {lastCost > 0 && (
              <div className="flex items-center gap-1.5">
                <span>费用</span>
                <span className="font-mono">${lastCost.toFixed(4)}</span>
              </div>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[10px]">
          {pct >= thresholdPct ? (
            <span className="text-red-500 font-medium">⚠ 即将压缩</span>
          ) : pct >= 60 ? (
            <span className="text-yellow-600 dark:text-yellow-400">接近阈值</span>
          ) : (
            <span className="text-green-600 dark:text-green-400">充裕</span>
          )}
        </div>
      </div>
      {/* 进度条 — 显示 contextWindow 使用率 + 压缩阈值线 */}
      <div className="relative mt-1.5 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${barColor} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
        {modelContext > 0 && (
          <div
            className="absolute inset-y-0 w-px bg-gray-700 dark:bg-gray-300"
            style={{ left: `${thresholdPct}%` }}
            title={`压缩阈值 (${fmtK(threshold)} tokens)`}
          />
        )}
      </div>
    </div>
  )
}
