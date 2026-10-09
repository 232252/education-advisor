// =============================================================
// 对话页面 — 纯 Agent 模式 (Agent 选择器 + 模型配置常驻显示)
// 编排层：组合侧栏/工具栏/消息列表/输入区，持有状态与副作用
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { useAgentStore } from '../../stores/agent/store'
import { useChatStore } from '../../stores/chat/store'
import { toast } from '../../stores/toastStore'
import { ChatToolbar } from './components/ChatToolbar'
import { Composer } from './components/Composer'
import { ContextStatusBar } from './components/ContextStatusBar'
import { MessageList } from './components/MessageList'
import { SessionSidebar } from './components/SessionSidebar'
import { useFileUpload } from './hooks/useFileUpload'
import {
  buildFinalText,
  queueActionAfterTurn,
  restoreQueuedIfUnsent,
  takeQueuedForSteering,
  toAgentHistory,
} from './lib/chat-message'

export function ChatPage() {
  const { t } = useT()
  const [input, setInput] = useState('')
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevStreamingRef = useRef(false)
  const steeringModeRef = useRef<'all' | 'one-at-a-time'>('all')
  const skipQueueFlushRef = useRef(false)
  /** 已出队、80ms 后才真正发送。被新的发送打断时用它放回队首。 */
  const pendingReleaseRef = useRef<{ text: string; finalText: string } | null>(null)
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const queuedCount = useChatStore((s) => s.queuedInputs.length)
  const currentProvider = useChatStore((s) => s.currentProvider)
  const currentModel = useChatStore((s) => s.currentModel)
  const currentModelContext = useChatStore((s) => s.currentModelContext)
  const currentModelMaxOutput = useChatStore((s) => s.currentModelMaxOutput)
  const lastUsage = useChatStore((s) => s.lastUsage)
  const lastModel = useChatStore((s) => s.lastModel)
  const lastCost = useChatStore((s) => s.lastCost)
  const thinkingLevel = useChatStore((s) => s.thinkingLevel)
  const reasoningLevels = useChatStore((s) => s.currentModelReasoningLevels)
  const sessionId = useChatStore((s) => s.sessionId)
  const sessions = useChatStore((s) => s.sessions)
  const selectedAgentId = useChatStore((s) => s.selectedAgentId)
  const setModel = useChatStore((s) => s.setModel)
  const setThinkingLevel = useChatStore((s) => s.setThinkingLevel)
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const loadHistory = useChatStore((s) => s.loadHistory)
  const createSession = useChatStore((s) => s.createSession)
  const switchSession = useChatStore((s) => s.switchSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const loadSessions = useChatStore((s) => s.loadSessions)

  // Agent 列表（从 agentStore 获取;初始加载由 App 级 bootstrap 负责,见 App.tsx）
  const agents = useAgentStore((s) => s.agents)

  // 文件上传（选择/读取/移除已上传文件）
  const { uploadedFiles, setUploadedFiles, handleUpload, removeFile } = useFileUpload()

  useEffect(() => {
    const enabledAgents = agents.filter((a) => a.enabled)
    if (!selectedAgentId && enabledAgents.length > 0) {
      setSelectedAgent(enabledAgents[0].id)
    }
  }, [agents, selectedAgentId, setSelectedAgent])

  // Agent 事件桥在 App 级 useChatAgentBridge 常驻订阅。
  // 不可在本页订阅:卸载 = 退订,跳到其他页面后流式回复与落库都会停。
  useEffect(() => {
    return () => {
      if (useChatStore.getState().isStreaming) {
        toast.info(t('toast.chat.backgroundContinue', '助手仍在后台回复，回到「对话」即可查看进度'))
      }
    }
  }, [t])

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

  // 自动滚动 — 只在用户仍"贴底"时跟随(上滑阅读历史不被拽回);
  // 直赋值 scrollTop:smooth 动画每 50ms flush 重启会抖动(2026-08-28 流畅度审计)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const followBottomRef = useRef(true)
  // useCallback 稳定化(流畅度审计 2026-09-02): ChatPage 每 50ms 流式 flush 重渲一次,
  // 内联函数会让 memo 化的 MessageList/Toolbar/Sidebar/ContextStatusBar/Composer 全部击穿
  const handleUserScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    followBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 触发器式 effect，仅依赖消息变化来执行滚动
  useEffect(() => {
    if (!followBottomRef.current) return
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  const handleModelSelect = useCallback(
    async (provider: string, model: string) => {
      setModel(provider, model)
      try {
        await getAPI().settings.set('models.defaultProvider', provider)
        await getAPI().settings.set('models.highQualityModel', model)
      } catch {
        // R2-14: 保存失败必须可见 — 静默回退会让用户以为已配置,重启后悄悄还原
        toast.warning(t('toast.settings.saveFailed', '设置保存失败,重启后将恢复上次选择'))
      }
    },
    [setModel, t],
  )

  const handleThinkingLevelChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value
      setThinkingLevel(value)
      try {
        // C-1 修复: 写入 chat.thinkingLevel 而非 chat.maxTokens(后者是 number,会被字符串覆盖损坏)
        await getAPI().settings.set('chat.thinkingLevel', value)
      } catch {
        toast.warning(t('toast.settings.saveFailed', '设置保存失败,重启后将恢复上次选择'))
      }
    },
    [setThinkingLevel, t],
  )

  /** 回滚"发送即反馈"的乐观态: 移除末尾空气泡并复位流式标志 */
  const rollbackOptimisticState = useCallback(() => {
    useChatStore.setState((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant' && !last.content) msgs.pop()
      return {
        messages: msgs,
        isStreaming: false,
        isThinking: false,
        streamingAgentId: null,
        streamSessionId: null,
      }
    })
  }, [])

  /** 实际执行一次发送(直发与排队 flush 共用) — text 为气泡展示原文,finalText 含附件拼装 */
  const performSend = useCallback(
    async (text: string, finalText: string) => {
      if (!selectedAgentId) {
        toast.warning(t('toast.chat.selectAgentFirst'))
        return
      }
      // 在添加新消息之前，抓取现有对话历史（用于传给 Agent 做上下文）
      // toAgentHistory: 透传原始时间戳 + 附带工具结果快照(否则模型无法基于上一轮数据追问)
      const currentMessages = useChatStore.getState().messages
      const history = toAgentHistory(currentMessages)

      // 添加用户消息 (显示原始文本,但传给 Agent 的是 finalText)
      useChatStore.getState().addMessage({
        role: 'user',
        content: text,
        timestamp: Date.now(),
      })
      // 用户发消息 = 明确回到对话底部,重新启用自动跟随
      followBottomRef.current = true

      // 发送即反馈(R2+ 审计 HIGH): 乐观创建空气泡+置位流式态 —
      // 此前 runAgent 排队/buildAgentTools 期间界面完全静止,用户不知道消息是否发出。
      // running 事件到达后走"复用末条 assistant"路径,不会重复建气泡。
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now(),
      })
      useChatStore.setState((s) => ({
        isStreaming: true,
        isThinking: true,
        streamingAgentId: selectedAgentId,
        streamSessionId: s.sessionId,
      }))

      // 启动 Agent（fire-and-forget，事件通过 onStatusUpdate 桥接）
      // 传入对话历史和包含文件内容的最终文本
      try {
        // 渲染端补角(2026-08-28 智能轮核查): runManual 前置校验失败(agent 不存在/
        // 已停用等)返回 {success:false} 而非 reject — 此前返回值无人检查,
        // 也不会有任何 agent 事件到达 → 空气泡+流式态永久卡死。现在显式回滚。
        const res = await getAPI().agent.runManual(selectedAgentId, finalText, history)
        if (res && typeof res === 'object' && 'success' in res && !res.success) {
          const reason = res.message ?? ''
          rollbackOptimisticState()
          toast.error(reason || t('toast.agents.runFailed'))
          return
        }
      } catch (err) {
        console.error('[Chat] Agent run failed:', err)
        // 回滚乐观态: invoke 本身失败时不会有 agent 事件来清理(空气泡一并移除)
        rollbackOptimisticState()
        toast.error(t('toast.agents.runFailed'))
      }
    },
    [selectedAgentId, t, rollbackOptimisticState],
  )

  const scheduleQueuedRelease = useCallback(
    (send: { text: string; finalText: string }, rest: { text: string; finalText: string }[]) => {
      pendingReleaseRef.current = send
      useChatStore.setState({ queuedInputs: rest })
      window.setTimeout(() => {
        if (pendingReleaseRef.current !== send) return
        pendingReleaseRef.current = null
        void performSend(send.text, send.finalText)
      }, 80)
    },
    [performSend],
  )

  const restorePendingRelease = useCallback(() => {
    const pending = pendingReleaseRef.current
    if (!pending) return
    pendingReleaseRef.current = null
    useChatStore.setState((s) => ({
      queuedInputs: restoreQueuedIfUnsent(s.queuedInputs, pending, false),
    }))
  }, [])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) {
      if (!isStreaming && useChatStore.getState().queuedInputs.length > 0) {
        const queued = useChatStore.getState().queuedInputs
        const taken = takeQueuedForSteering(queued, steeringModeRef.current)
        const send = taken.send
        if (!send) return
        scheduleQueuedRelease(send, taken.rest)
      }
      return
    }
    restorePendingRelease()
    if (!selectedAgentId) {
      toast.warning(t('toast.chat.selectAgentFirst'))
      return
    }

    // 拼接上传文件内容到消息文本(text=气泡展示原文,finalText=发给 Agent 的)
    const displayText =
      uploadedFiles.length > 0
        ? `${text}\n\n[${t('page.chat.input.attachPrefix', '已附加')} ${uploadedFiles.length} ${t('page.chat.input.attachUnit', '个文件')}: ${uploadedFiles.map((f) => f.name).join(', ')}]`
        : text
    const finalText = buildFinalText(text, uploadedFiles)
    setInput('')
    setUploadedFiles([])

    // P2-7: 运行中不再锁死输入。消息先排队，这轮结束再发。
    // 引导模式「全部」把排着的合成一条；「一次一个」每轮只发下一条。
    // 不中断正在跑的工具，避免长任务被一句追问打断。
    if (isStreaming) {
      useChatStore.setState((s) => ({
        queuedInputs: [...s.queuedInputs, { text: displayText, finalText }],
      }))
      toast.info(
        steeringModeRef.current === 'one-at-a-time'
          ? t('page.chat.queuedNotice.one', '已排队，这轮结束后只发送下一条')
          : t('page.chat.queuedNotice.all', '已排队，这轮结束后一并发送'),
      )
      return
    }
    void performSend(displayText, finalText)
  }, [
    input,
    isStreaming,
    selectedAgentId,
    uploadedFiles,
    setUploadedFiles,
    performSend,
    scheduleQueuedRelease,
    restorePendingRelease,
    t,
  ])

  // 排队消息在回复结束时发出。默认「全部」合成一条；「一次一个」只出队第一条。
  useEffect(() => {
    void getAPI()
      .settings.get()
      .then((settings) => {
        steeringModeRef.current =
          settings?.chat?.steeringMode === 'one-at-a-time' ? 'one-at-a-time' : 'all'
      })
      .catch(() => {
        /* 读不到时按「全部」 */
      })
  }, [])
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    prevStreamingRef.current = isStreaming
    if (!wasStreaming || isStreaming) return
    const queuedNow = useChatStore.getState().queuedInputs
    const action = queueActionAfterTurn(skipQueueFlushRef.current, queuedNow.length)
    skipQueueFlushRef.current = false
    if (action === 'hold') {
      toast.info(t('page.chat.queuedHeld', '已停止。排队的消息还在，输入框空着时点「发送排队」'))
      return
    }
    if (action !== 'send') return
    let cancelled = false
    void (async () => {
      let mode: 'all' | 'one-at-a-time' = steeringModeRef.current
      try {
        const settings = await getAPI().settings.get()
        mode = settings?.chat?.steeringMode === 'one-at-a-time' ? 'one-at-a-time' : 'all'
        steeringModeRef.current = mode
      } catch {
        /* 用上次读到的模式 */
      }
      if (cancelled) return
      const queued = useChatStore.getState().queuedInputs
      const taken = takeQueuedForSteering(queued, mode)
      const send = taken.send
      if (!send) return
      scheduleQueuedRelease(send, taken.rest)
    })()
    return () => {
      cancelled = true
      restorePendingRelease()
    }
  }, [isStreaming, restorePendingRelease, scheduleQueuedRelease, t])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const hasAgent = selectedAgentId
  const canSend = !!hasAgent

  // 可用的 Agent 列表（仅启用的）
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  // 停止按钮的处理
  const handleStop = useCallback(() => {
    if (selectedAgentId) {
      skipQueueFlushRef.current = true
      getAPI().agent.abort(selectedAgentId)
      useChatStore.setState({ isStreaming: false })
    }
  }, [selectedAgentId])

  // Composer 占位文本(memo 配套: 引用稳定避免击穿)
  const composerPlaceholder = useMemo(
    () =>
      canSend
        ? `${t('page.chat.input.sendTo', '向')} ${enabledAgents.find((a) => a.id === selectedAgentId)?.name ?? 'Agent'} ${t('page.chat.input.sendSuffix', '发送指令... (Enter 发送)')}`
        : t('page.chat.input.loading', '正在加载...'),
    [canSend, enabledAgents, selectedAgentId, t],
  )

  const createSessionHandler = useCallback(() => createSession(), [createSession])

  return (
    <div className="flex h-full min-h-0 overflow-hidden animate-fade-in">
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
        onCreateSession={createSessionHandler}
        onSwitchSession={switchSession}
        onRequestDelete={setPendingDeleteSessionId}
      />

      {/* 主对话区域 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* 顶部工具栏 — 纯 Agent 模式: Agent 选择器 + 模型配置 + 思考级别 常驻显示 */}
        <ChatToolbar
          enabledAgents={enabledAgents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgent}
          thinkingLevel={thinkingLevel}
          reasoningLevels={reasoningLevels}
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
          lastModel={lastModel}
        />

        {/* 消息区 */}
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          canSend={canSend}
          sessionKey={sessionId}
          messagesEndRef={messagesEndRef}
          scrollContainerRef={scrollContainerRef}
          onUserScroll={handleUserScroll}
        />

        {/* 输入区 */}
        <Composer
          input={input}
          onInputChange={setInput}
          inputRef={inputRef}
          onKeyDown={handleKeyDown}
          placeholder={composerPlaceholder}
          isStreaming={isStreaming}
          canSend={canSend}
          uploadedFiles={uploadedFiles}
          onUpload={handleUpload}
          onRemoveFile={removeFile}
          onSend={handleSend}
          onStop={handleStop}
          queuedCount={queuedCount}
        />
      </div>
      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        title={t('common.delete')}
        message={
          pendingDeleteSessionId
            ? `${t('common.delete')} ${sessions.find((s) => s.id === pendingDeleteSessionId)?.title ?? ''}？${t('common.deleteIrreversible', '此操作不可恢复。')}`
            : `${t('common.delete')}?`
        }
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
