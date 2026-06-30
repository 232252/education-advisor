// =============================================================
// Chat Store — 对话状态管理 (Zustand)
// 支持流式文本、思考过程、工具调用、用量统计
// 支持对话持久化（通过 IPC 到 SQLite）
// 支持双模式: 直接对话 (direct) / Agent 模式 (agent)
// =============================================================

import type { ChatMessage, StreamEvent, TokenUsage } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'
import { toast } from './toastStore'

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
  /** High 3.2 配套: 跟踪当前 isStreaming 是由哪个 agent 触发的,
   *  避免 handleAgentEvent 中清理逻辑误清新 agent 的流状态 */
  streamingAgentId: string | null

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

/** CONCERN 修复: 切走 agent 期间的 pending output 缓存,切回时合并
 *  避免 R-1 修复引入的"切走期间文本丢失"问题
 *  使用模块级变量而非 Zustand 状态,避免不必要的 re-render */
const pendingAgentOutputs = new Map<string, string[]>()

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  isThinking: false,
  streamingAgentId: null,
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
        .catch((err) => {
          console.warn('[chatStore] saveMessage failed (user)', err)
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
              .catch((err) => {
                console.warn('[chatStore] saveMessage failed (assistant stream)', err)
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
      // C-1 修复: 从 settings 恢复 thinkingLevel 到 UI
      const thinkingLevel = s.chat?.thinkingLevel
      if (thinkingLevel) {
        set({ thinkingLevel })
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
  // High 3.2 修复: 切 agent 时主动清理 isStreaming/isThinking,
  // 避免旧 agent 的 running 事件把 isStreaming 置 true 后切换到新 agent 时卡死
  // R-1 修复: 不重置 streamingAgentId,以便切回原 agent 时能检测到"未完成的流"并复用
  // 最后一条 assistant 消息,避免重复创建消息气泡。
  // isStreaming 仍需重置以保证切到新 agent 时 UI 不显示 streaming 状态。
  setSelectedAgent: (id) =>
    set({
      selectedAgentId: id,
      isStreaming: false,
      isThinking: false,
    }),

  // === Agent 事件桥接 — 把 AgentStatusUpdate 映射到 chat 消息 ===
  handleAgentEvent: (data) => {
    const state = get()
    // High 3.2 修复: 切 agent 时旧 agent 的 idle/error 被过滤导致 isStreaming 卡死
    // 之前直接 return,旧 agent 的 idle/error 事件被丢弃,isStreaming 永远不会重置
    // 修复策略 v1: 对于 idle/error 终止事件,即使 agentId 不匹配也要清理可能残留的 isStreaming 状态
    // 修复策略 v2(避免 v1 引入的回归): 只有当 idle/error 来自 streamingAgentId 时才清理,
    //   避免旧 agent 的 idle 事件错误清理新 agent 的流状态
    if (data.agentId !== state.selectedAgentId) {
      // CONCERN 修复: 缓存切走期间的 output,切回时合并到消息
      if (data.status === 'running' && data.output) {
        const buf = pendingAgentOutputs.get(data.agentId) ?? []
        buf.push(data.output)
        pendingAgentOutputs.set(data.agentId, buf)
      }
      // R-1 修复: 移除 isStreaming 条件 — 即使 isStreaming 已被 setSelectedAgent 重置为 false,
      // 终止事件(idle/error)仍需清理 streamingAgentId,否则后续同 agent 的新流会误判为"复用"
      if (
        (data.status === 'idle' || data.status === 'error') &&
        state.streamingAgentId === data.agentId
      ) {
        // 终止事件:清理缓存,重置流状态
        pendingAgentOutputs.delete(data.agentId)
        set({ isStreaming: false, isThinking: false, streamingAgentId: null })
      }
      return
    }

    switch (data.status) {
      case 'running': {
        // 第一次收到 running 且未在 streaming → 初始化或复用 assistant 消息
        if (!state.isStreaming) {
          // R-1 修复: 检测"切回原 agent"场景 — 若 streamingAgentId 仍指向当前 agent,
          // 说明流未被 idle/error 终止(用户只是切走又切回),复用最后一条 assistant 消息,
          // 避免重复创建消息气泡。
          const lastMsg = state.messages[state.messages.length - 1]
          if (state.streamingAgentId === data.agentId && lastMsg?.role === 'assistant') {
            // 复用:仅恢复 isStreaming,不新建消息
            set({ isStreaming: true, isThinking: false })
            // CONCERN 修复: 合并切走期间缓存的 output,避免文本截断
            const pending = pendingAgentOutputs.get(data.agentId)
            if (pending && pending.length > 0) {
              const combined = pending.join('')
              pendingAgentOutputs.delete(data.agentId)
              state.appendStreamDelta(combined)
            }
          } else {
            // 新流:记录 streamingAgentId + 新建 assistant 消息
            set({ isStreaming: true, isThinking: false, streamingAgentId: data.agentId })
            // LOW 修复: 清理非当前 agent 的残留缓存,防止 agent 崩溃(不发出 idle/error)
            // 导致 pendingAgentOutputs 内存泄漏。新流开始意味着用户关注当前 agent,
            // 之前切走期间的其他 agent 缓存已无意义(切回也会从新流开始)。
            for (const key of pendingAgentOutputs.keys()) {
              if (key !== data.agentId) pendingAgentOutputs.delete(key)
            }
            state.addMessage({
              role: 'assistant',
              content: '',
              toolCalls: [],
              timestamp: Date.now(),
            })
          }
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
            .catch((err) => {
              console.warn('[chatStore] saveMessage failed (agent)', err)
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
          streamingAgentId: null,
          lastUsage: usage,
          lastCost: data.result?.cost || 0,
        })
        break
      }

      case 'error': {
        // H-6 修复: 错误分支需要检查最后消息角色
        // 之前只在 !state.isStreaming 时创建 assistant 消息,
        // 但如果 streaming 已开始且最后消息不是 assistant(如用户在运行中发了新消息),
        // appendStreamDelta 会静默失败,错误信息丢失
        if (data.error) {
          const msgs = get().messages
          const lastMsg = msgs[msgs.length - 1]
          if (!state.isStreaming || !lastMsg || lastMsg.role !== 'assistant') {
            // streaming 未开始,或最后消息不是 assistant → 新建一条承载错误
            if (!state.isStreaming) {
              set({ isStreaming: true })
            }
            state.addMessage({
              role: 'assistant',
              content: `**错误:** ${data.error}`,
              timestamp: Date.now(),
            })
          } else {
            // 最后消息是 assistant → 追加错误信息
            get().appendStreamDelta(`\n\n**错误:** ${data.error}`)
          }
        }
        set({ isStreaming: false, isThinking: false, streamingAgentId: null })
        break
      }
    }
  },

  clearMessages: () => {
    // C-3 修复: clearMessages 只清空当前显示,不删除会话数据
    // 之前调 chat.deleteSession(sid) 会把整个会话从 DB 删除,导致用户数据丢失
    // 用户若想删除会话,应使用侧边栏每个会话项右侧的 × 按钮(调 deleteSession)
    set({ messages: [], lastUsage: null, lastCost: 0 })
  },

  loadHistory: async () => {
    if (get().historyLoaded) return
    // RISK 修复: 捕获当前 sessionId,await 后校验是否仍是当前 session
    // 之前用户快速切换 session 时,旧 loadHistory 的结果可能覆盖新 session 的消息
    const targetSessionId = get().sessionId
    try {
      const result = await getAPI().chat.loadMessages(targetSessionId)
      // 校验: await 期间 sessionId 可能已改变,若已切换则丢弃结果
      if (get().sessionId !== targetSessionId) return
      if (result.success && result.messages && result.messages.length > 0) {
        const loaded: ChatMessage[] = result.messages
          // HIGH 修复: 对 DB 返回的消息做运行时校验,避免类型断言掩盖数据损坏
          .filter(
            (m: Record<string, unknown>) =>
              typeof m?.role === 'string' &&
              typeof m?.content === 'string' &&
              typeof m?.timestamp === 'number',
          )
          .map((m: Record<string, unknown>) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content as string,
            thinking: typeof m.thinking === 'string' ? m.thinking : undefined,
            timestamp: m.timestamp as number,
          }))
          // H-1 配套: 过滤掉 createSession 写入的空 system 占位消息
          .filter((m) => !(m.role === 'system' && (!m.content || m.content.length === 0)))
        set({ messages: loaded, historyLoaded: true })
      } else {
        set({ historyLoaded: true })
      }
    } catch (err) {
      console.warn('[chatStore] loadHistory failed', err)
      // 错误时也校验 sessionId,避免错误状态覆盖新 session
      if (get().sessionId !== targetSessionId) return
      set({ historyLoaded: true })
    }
  },

  // === Session Management ===

  createSession: (title?: string) => {
    // RISK 修复: 加入随机后缀,避免 deleteSession 后立即 createSession
    // 生成相同 id(同毫秒 Date.now() 相同),导致旧 session id 复用,
    // 表现为 "deleteSession 后 session 仍在列表里"
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
    // H-1 修复: 持久化空会话到 DB,避免用户创建会话后未发消息就刷新导致会话丢失
    // 通过写入一条 system 角色的占位消息触发 syncSessionMeta 创建 session 记录
    // loadHistory 时会加载这条消息,但因 role='system' 且 content 为空,UI 不渲染
    getAPI()
      .chat.saveMessage({
        sessionId: id,
        role: 'system',
        content: '',
        timestamp: Date.now(),
      })
      .catch((err) => {
        console.warn('[chatStore] createSession persist failed', err)
      })
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
      .catch((err) => {
        console.warn('[chatStore] deleteSession failed', err)
        toast.error('删除会话失败,请查看日志')
      })
  },

  loadSessions: async () => {
    try {
      const result = await getAPI().chat.listSessions()
      if (result.success && result.sessions) {
        const dbSessions: ChatSession[] = result.sessions
          // HIGH 修复: 对 DB 返回的 session 做运行时校验,避免非法记录污染 sessions 数组
          .filter(
            (s: Record<string, unknown>) =>
              typeof s?.id === 'string' &&
              typeof s?.title === 'string' &&
              typeof s?.createdAt === 'number',
          )
          .map((s: Record<string, unknown>) => ({
            id: s.id as string,
            title: s.title as string,
            createdAt: s.createdAt as number,
            messageCount: typeof s.messageCount === 'number' ? s.messageCount : 0,
          }))
        // H-2 修复: 不直接覆盖 sessions,而是合并 DB sessions 和本地 sessions
        // 保留本地存在但 DB 不存在的会话(如刚 createSession 但 saveMessage 还在 flight)
        const localSessions = get().sessions
        const dbIds = new Set(dbSessions.map((s) => s.id))
        const localOnly = localSessions.filter((s) => !dbIds.has(s.id))
        const merged = [...dbSessions, ...localOnly]
        set({ sessions: merged })
        // 如果没有会话，自动创建一个
        if (merged.length === 0) {
          get().createSession()
        }
      }
    } catch (err) {
      console.warn('[chatStore] loadSessions failed', err)
    }
  },
}))
