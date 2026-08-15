// =============================================================
// 对话页面 — 纯 Agent 模式 (Agent 选择器 + 模型配置常驻显示)
// 编排层：组合侧栏/工具栏/消息列表/输入区，持有状态与副作用
// =============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { useAgentStore } from '../../stores/agentStore'
import { useChatStore } from '../../stores/chatStore'
import { toast } from '../../stores/toastStore'
import { ChatToolbar } from './components/ChatToolbar'
import { Composer } from './components/Composer'
import { ContextStatusBar } from './components/ContextStatusBar'
import { MessageList } from './components/MessageList'
import { SessionSidebar } from './components/SessionSidebar'
import { useFileUpload } from './hooks/useFileUpload'
import { buildFinalText } from './lib/chat-message'

export function ChatPage() {
  const { t } = useT()
  const [input, setInput] = useState('')
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  // 文件上传（选择/读取/移除已上传文件）
  const { uploadedFiles, setUploadedFiles, handleUpload, removeFile } = useFileUpload()

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
      // C-1 修复: 写入 chat.thinkingLevel 而非 chat.maxTokens(后者是 number,会被字符串覆盖损坏)
      await getAPI().settings.set('chat.thinkingLevel', value)
    } catch {
      /* silent */
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return

    const text = input.trim()
    setInput('')

    if (!selectedAgentId) {
      toast.warning(t('toast.chat.selectAgentFirst'))
      return
    }

    // 在添加新消息之前，抓取现有对话历史（用于传给 Agent 做上下文）
    const currentMessages = useChatStore.getState().messages
    const history = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // 拼接上传文件内容到消息文本
    const finalText = buildFinalText(text, uploadedFiles)

    // 添加用户消息 (显示原始文本,但传给 Agent 的是 finalText)
    useChatStore.getState().addMessage({
      role: 'user',
      content:
        uploadedFiles.length > 0
          ? `${text}\n\n[已附加 ${uploadedFiles.length} 个文件: ${uploadedFiles.map((f) => f.name).join(', ')}]`
          : text,
      timestamp: Date.now(),
    })

    // 清空已上传文件
    setUploadedFiles([])

    // 启动 Agent（fire-and-forget，事件通过 onStatusUpdate 桥接）
    // 传入对话历史和包含文件内容的最终文本
    try {
      await getAPI().agent.runManual(selectedAgentId, finalText, history)
    } catch (err) {
      console.error('[Chat] Agent run failed:', err)
      toast.error(t('toast.agents.runFailed'))
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
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  // 停止按钮的处理
  const handleStop = () => {
    if (selectedAgentId) {
      getAPI().agent.abort(selectedAgentId)
      useChatStore.setState({ isStreaming: false })
    }
  }

  return (
    <div className="flex h-full animate-fade-in">
      <h1
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {t('page.chat.title')}
      </h1>
      {/* 左侧会话列表 */}
      <SessionSidebar
        sessions={sessions}
        currentSessionId={sessionId}
        onCreateSession={() => createSession()}
        onSwitchSession={switchSession}
        onRequestDelete={setPendingDeleteSessionId}
      />

      {/* 主对话区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部工具栏 — 纯 Agent 模式: Agent 选择器 + 模型配置 + 思考级别 常驻显示 */}
        <ChatToolbar
          enabledAgents={enabledAgents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgent}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={handleThinkingLevelChange}
          selectedProvider={currentProvider}
          selectedModel={currentModel}
          onModelSelect={handleModelSelect}
          onClearMessages={clearMessages}
        />

        {/* 上下文状态条 - 显示当前模型 contextWindow / 已用 token / 压缩进度 */}
        <ContextStatusBar
          modelContext={currentModelContext}
          modelMaxOutput={currentModelMaxOutput}
          lastUsage={lastUsage}
          lastCost={lastCost}
        />

        {/* 消息区 */}
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          canSend={canSend}
          messagesEndRef={messagesEndRef}
        />

        {/* 输入区 */}
        <Composer
          input={input}
          onInputChange={setInput}
          inputRef={inputRef}
          onKeyDown={handleKeyDown}
          placeholder={
            canSend
              ? `向 ${enabledAgents.find((a) => a.id === selectedAgentId)?.name ?? 'Agent'} 发送指令... (Enter 发送)`
              : '正在加载...'
          }
          isStreaming={isStreaming}
          canSend={canSend}
          uploadedFiles={uploadedFiles}
          onUpload={handleUpload}
          onRemoveFile={removeFile}
          onSend={handleSend}
          onStop={handleStop}
        />
      </div>
      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        title={t('common.delete')}
        message={`${t('common.delete')}?`}
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteSessionId) {
            deleteSession(pendingDeleteSessionId)
          }
          setPendingDeleteSessionId(null)
        }}
        onCancel={() => setPendingDeleteSessionId(null)}
      />
    </div>
  )
}
