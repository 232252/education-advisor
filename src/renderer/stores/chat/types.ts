// =============================================================
// Chat Store 类型定义 — 会话 / 模式 / Agent 桥接事件 / 状态与 Actions
// =============================================================

import type { ChatMessage, TokenUsage } from '@shared/types'
import type { StoreApi } from 'zustand'

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  messageCount: number
}

interface AgentBridgeEvent {
  agentId: string
  status: string
  output?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; isError: boolean; preview?: string }
  result?: { output: string; tokenUsage?: TokenUsage; cost?: number; model?: string }
  error?: string
  /** 上下文压缩已发生(R2+ 可见性) */
  compacted?: boolean
}

export interface ChatState {
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
  /** 最近一次 agent 运行实际使用的模型(provider/id) — 降级可见性 */
  lastModel: string
  sessionId: string
  historyLoaded: boolean
  sessions: ChatSession[]

  // Agent 模式
  selectedAgentId: string
  /** High 3.2 配套: 跟踪当前 isStreaming 是由哪个 agent 触发的,
   *  避免 handleAgentEvent 中清理逻辑误清新 agent 的流状态 */
  streamingAgentId: string | null
  /** 流启动时所在的会话 id — 切换会话后,旧流的后续事件/落库不得写入新会话(串台修复) */
  streamSessionId: string | null

  // Actions
  addMessage: (msg: ChatMessage) => void
  appendStreamDelta: (delta: string) => void
  appendThinkingDelta: (delta: string) => void
  /** 立即 flush 50ms 批处理缓冲的 delta(测试与"停止/切换前落盘"场景) */
  flushDeltas: () => void
  handleAgentEvent: (data: AgentBridgeEvent) => void
  setModel: (provider: string, model: string) => void
  setModelContext: (contextWindow: number, maxOutput: number) => void
  fetchModelInfo: (provider: string, model: string) => Promise<void>
  initFromSettings: () => Promise<void>
  setThinkingLevel: (level: string) => void
  setSelectedAgent: (id: string) => void
  clearMessages: () => void
  loadHistory: () => Promise<void>

  // Session management
  createSession: (title?: string) => void
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  loadSessions: () => Promise<void>
}

/** slice 共用的 set/get 类型(与 create<ChatState> 回调注入的同型) */
export type ChatSet = StoreApi<ChatState>['setState']
export type ChatGet = StoreApi<ChatState>['getState']
