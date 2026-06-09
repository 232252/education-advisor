// =============================================================
// Chat Store — 对话状态管理 (Zustand)
// 支持流式文本、思考过程、工具调用、用量统计
// 支持对话持久化（通过 IPC 到 SQLite）
// 支持双模式: 直接对话 (direct) / Agent 模式 (agent)
// =============================================================

import type { ChatMessage, StreamEvent, TokenUsage } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  messageCount: number
}

export type ChatMode = 'direct' | 'agent'

interface AgentBridgeEvent {
  agentId: string
  status: string
  output?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; isError: boolean }
  result?: { output: string; tokenUsage?: TokenUsage; cost?: number }
  error?: string
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  isThinking: boolean
  currentModel: string
  currentProvider: string
  /** 当前选中模型的 contextWindow(从 ai.listModels 拉的, 用户填的) */
  currentModelContext: number
  /** 当前选中模型的 maxOutputTokens */
  currentModelMaxOutput: number
  thinkingLevel: string
  lastUsage: TokenUsage | null
  lastCost: number
  sessionId: string
  historyLoaded: boolean
  sessions: ChatSession[]

  // Agent 模式
  chatMode: ChatMode
  selectedAgentId: string

  // Actions
  addMessage: (msg: ChatMessage) => void
  appendStreamDelta: (delta: string) => void
  appendThinkingDelta: (delta: string) => void
  handleStreamEvent: (event: StreamEvent) => void
  handleAgentEvent: (data: AgentBridgeEvent) => void
  setModel: (provider: string, model: string) => void
  setModelContext: (contextWindow: number, maxOutput: number) => void
  fetchModelInfo: (provider: string, model: string) => Promise<void>
  initFromSettings: () => Promise<void>
  setThinkingLevel: (level: string) => void
  setChatMode: (mode: ChatMode) => void
  setSelectedAgent: (id: string) => void
  clearMessages: () => void
  loadHistory: () => Promise<void>

  // Session management
  createSession: (title?: string) => void
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  loadSessions: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  isThinking: false,
  currentModel: '',
  currentProvider: '',
  currentModelContext: 0,
  currentModelMaxOutput: 0,
  thinkingLevel: 'off',
  lastUsage: null,
  lastCost: 0,
  sessionId: 'default',
  historyLoaded: false,
  sessions: [],
  chatMode: 'direct',
  selectedAgentId: '',

  addMessage: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }))
    // Persist to DB (fire-and-forget)
    // 只立即保存 user 消息; assistant 消息在 text_end 事件中保存完整内容
    if (msg.role !== 'assistant') {
      getAPI()
        .chat.saveMessage({
          sessionId: get().sessionId,
          role: msg.role,
          content: msg.content,
          thinking: msg.thinking,
          timestamp: msg.timestamp,
        })
        .catch(() => {
          /* silent fail */
        })
    }
  },

  appendStreamDelta: (delta) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta }
      }
      return { messages: msgs }
    }),

  appendThinkingDelta: (delta) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, thinking: (last.thinking ?? '') + delta }
      }
      return { messages: msgs }
    }),

  handleStreamEvent: (event) => {
    const state = get()
    switch (event.type) {
      case 'start':
        set({ isStreaming: true, isThinking: false })
        state.addMessage({
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        })
        break

      case 'text_start':
        set({ isThinking: false })
        break

      case 'text_delta':
        state.appendStreamDelta(event.delta)
        break

      case 'text_end':
        {
          const msgs = get().messages
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg?.role === 'assistant') {
            getAPI()
              .chat.saveMessage({
                sessionId: get().sessionId,
                role: 'assistant',
                content: lastMsg.content,
                thinking: lastMsg.thinking,
                timestamp: lastMsg.timestamp,
                provider: get().currentProvider || undefined,
                model: get().currentModel || undefined,
              })
              .catch(() => {
                /* silent fail */
              })
          }
        }
        break

      case 'thinking_start':
        set({ isThinking: true })
        break

      case 'thinking_delta':
        state.appendThinkingDelta(event.delta)
        break

      case 'thinking_end':
        set({ isThinking: false })
        break

      case 'toolcall_start':
        set((s) => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = {
              ...last,
              toolCalls: [...(last.toolCalls || []), { id: event.id, name: event.name, args: {} }],
            }
          }
          return { messages: msgs }
        })
        break

      case 'toolcall_delta':
        // args 增量 — 暂不拼接，由 toolcall_end 或 tool_result 补全
        break

      case 'toolcall_end':
        break

      case 'tool_result':
        set((s) => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant' && last.toolCalls) {
            const tcs = last.toolCalls.map((tc) =>
              tc.id === event.id ? { ...tc, result: event.result, isError: event.isError } : tc,
            )
            msgs[msgs.length - 1] = { ...last, toolCalls: tcs }
          }
          return { messages: msgs }
        })
        break

      case 'done':
        set({
          isStreaming: false,
          isThinking: false,
          lastUsage: event.usage,
          lastCost: event.cost,
        })
        break

      case 'error':
        set({ isStreaming: false, isThinking: false })
        state.addMessage({
          role: 'assistant',
          content: `**错误:** ${event.message}`,
          timestamp: Date.now(),
        })
        break
    }
  },

  setModel: (provider, model) => {
    set({ currentProvider: provider, currentModel: model })
    // 异步拉模型的 contextWindow
    void get().fetchModelInfo(provider, model)
  },
  setModelContext: (contextWindow, maxOutput) =>
    set({ currentModelContext: contextWindow, currentModelMaxOutput: maxOutput }),
  /**
   * 启动时从 settings 同步当前模型(provider + model)
   * 修复 Bug-1: chatStore 初始化时 currentProvider/currentModel 是空串,
   *              不主动从 settings 拉, UI 永远显示"未设置"
   */
  initFromSettings: async () => {
    try {
      const s = await getAPI().settings.get()
      const provider = s.models?.defaultProvider || ''
      const model =
        s.models?.defaultModel || s.models?.highQualityModel || s.models?.lowCostModel || ''
      if (provider || model) {
        set({ currentProvider: provider, currentModel: model })
        if (provider && model) {
          void get().fetchModelInfo(provider, model)
        }
      }
    } catch (err) {
      console.warn('[chatStore] initFromSettings failed:', err)
    }
  },
  /**
   * 从主进程拉取指定模型的 contextWindow / maxOutput
   * 修复 Bug-1: 真正从用户 settings 透传,不在前端硬编码
   */
  fetchModelInfo: async (provider, model) => {
    if (!provider || !model) {
      console.log(`[chatStore] fetchModelInfo skipped: provider=${provider} model=${model}`)
      return
    }
    try {
      const models = await getAPI().ai.listModels(provider)
      console.log(
        `[chatStore] fetchModelInfo: provider=${provider} model=${model} returned ${models.length} models:`,
        models.map((m) => `${m.id}@${m.contextWindow}`),
      )
      const found = models.find((m) => m.id === model)
      if (found) {
        console.log(
          `[chatStore] model matched: ${model} contextWindow=${found.contextWindow} maxOutput=${found.maxOutputTokens}`,
        )
        set({
          currentModelContext: found.contextWindow || 0,
          currentModelMaxOutput: found.maxOutputTokens || 0,
        })
      } else {
        console.warn(
          `[chatStore] model ${model} not found in listModels(${provider}); available:`,
          models.map((m) => m.id),
        )
      }
    } catch (err) {
      console.warn('[chatStore] fetchModelInfo failed:', err)
    }
  },
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  setChatMode: (mode) => set({ chatMode: mode }),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),

  // === Agent 事件桥接 — 把 AgentStatusUpdate 映射到 chat 消息 ===
  handleAgentEvent: (data) => {
    const state = get()
    // 忽略其他 agent 的事件（只处理当前选中的 agent）
    if (data.agentId !== state.selectedAgentId) return

    switch (data.status) {
      case 'running': {
        // 第一次收到 running 且未在 streaming → 初始化 assistant 消息
        if (!state.isStreaming) {
          set({ isStreaming: true, isThinking: false })
          state.addMessage({
            role: 'assistant',
            content: '',
            toolCalls: [],
            timestamp: Date.now(),
          })
        }
        // 追加文本输出
        if (data.output) {
          state.appendStreamDelta(data.output)
        }
        // 追加工具调用
        if (data.toolCall) {
          const toolCall = data.toolCall
          set((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant') {
              msgs[msgs.length - 1] = {
                ...last,
                toolCalls: [
                  ...(last.toolCalls || []),
                  {
                    id: `tc_${Date.now()}`,
                    name: toolCall.name,
                    args: (toolCall.args as Record<string, unknown>) || {},
                  },
                ],
              }
            }
            return { messages: msgs }
          })
        }
        // 工具结果 — 更新最后一个同名工具的 result
        if (data.toolResult) {
          const toolResult = data.toolResult
          set((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant' && last.toolCalls) {
              const tcs = [...last.toolCalls]
              // 从后往前找最后一个匹配名称的工具调用
              for (let i = tcs.length - 1; i >= 0; i--) {
                if (tcs[i].name === toolResult.name && !tcs[i].result) {
                  tcs[i] = {
                    ...tcs[i],
                    result: toolResult.isError ? 'error' : 'success',
                    isError: toolResult.isError,
                  }
                  break
                }
              }
              msgs[msgs.length - 1] = { ...last, toolCalls: tcs }
            }
            return { messages: msgs }
          })
        }
        break
      }

      case 'idle': {
        // Agent 执行完成 — 保存消息并结束 streaming
        const msgs = get().messages
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg?.role === 'assistant') {
          getAPI()
            .chat.saveMessage({
              sessionId: get().sessionId,
              role: 'assistant',
              content: lastMsg.content,
              thinking: lastMsg.thinking,
              timestamp: lastMsg.timestamp,
              provider: `agent:${data.agentId}`,
              model: data.agentId,
            })
            .catch(() => {
              /* silent fail */
            })
        }
        const usage: TokenUsage = data.result?.tokenUsage || {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        set({
          isStreaming: false,
          isThinking: false,
          lastUsage: usage,
          lastCost: data.result?.cost || 0,
        })
        break
      }

      case 'error': {
        if (data.error && !state.isStreaming) {
          // streaming 未开始就出错（如启动失败）
          set({ isStreaming: true })
          state.addMessage({
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
          })
        }
        if (data.error) {
          get().appendStreamDelta(`\n\n**错误:** ${data.error}`)
        }
        set({ isStreaming: false, isThinking: false })
        break
      }
    }
  },

  clearMessages: () => {
    const sid = get().sessionId
    set({ messages: [], lastUsage: null, lastCost: 0 })
    getAPI()
      .chat.deleteSession(sid)
      .catch(() => {
        /* silent fail */
      })
  },

  loadHistory: async () => {
    if (get().historyLoaded) return
    try {
      const result = await getAPI().chat.loadMessages(get().sessionId)
      if (result.success && result.messages && result.messages.length > 0) {
        const loaded: ChatMessage[] = result.messages.map((m: Record<string, unknown>) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content as string,
          thinking: m.thinking as string | undefined,
          timestamp: m.timestamp as number,
        }))
        set({ messages: loaded, historyLoaded: true })
      } else {
        set({ historyLoaded: true })
      }
    } catch {
      set({ historyLoaded: true })
    }
  },

  // === Session Management ===

  createSession: (title?: string) => {
    const id = `session_${Date.now()}`
    const newSession: ChatSession = {
      id,
      title: title || `新对话 ${new Date().toLocaleTimeString()}`,
      createdAt: Date.now(),
      messageCount: 0,
    }
    set((s) => ({
      sessions: [newSession, ...s.sessions],
      sessionId: id,
      messages: [],
      lastUsage: null,
      lastCost: 0,
      historyLoaded: false,
    }))
  },

  switchSession: (id: string) => {
    if (get().sessionId === id) return
    set({
      sessionId: id,
      messages: [],
      lastUsage: null,
      lastCost: 0,
      historyLoaded: false,
    })
    // 加载该会话的历史消息
    get().loadHistory()
  },

  deleteSession: (id: string) => {
    const state = get()
    // 从列表中移除
    set((s) => ({
      sessions: s.sessions.filter((ses) => ses.id !== id),
    }))
    // 如果删除的是当前会话，切换到第一个可用会话或创建新会话
    if (state.sessionId === id) {
      const remaining = get().sessions
      if (remaining.length > 0) {
        get().switchSession(remaining[0].id)
      } else {
        get().createSession()
      }
    }
    // 异步清理持久化数据
    getAPI()
      .chat.deleteSession(id)
      .catch(() => {
        /* silent fail */
      })
  },

  loadSessions: async () => {
    try {
      const result = await getAPI().chat.listSessions()
      if (result.success && result.sessions) {
        const sessions: ChatSession[] = result.sessions.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          title: s.title as string,
          createdAt: s.createdAt as number,
          messageCount: s.messageCount as number,
        }))
        set({ sessions })
        // 如果没有会话，自动创建一个
        if (sessions.length === 0) {
          get().createSession()
        }
      }
    } catch {
      // 静默失败
    }
  },
}))
