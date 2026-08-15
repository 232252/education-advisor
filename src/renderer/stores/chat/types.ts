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

export interface AgentBridgeEvent {
  agentId: string
  status: string
  output?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; isError: boolean }
  result?: { output: string; tokenUsage?: TokenUsage; cost?: number }
  error?: string
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
  sessionId: string
  historyLoaded: boolean
  sessions: ChatSession[]

  // Agent 模式
  selectedAgentId: string
  /** High 3.2 配套: 跟踪当前 isStreaming 是由哪个 agent 触发的,
   *  避免 handleAgentEvent 中清理逻辑误清新 agent 的流状态 */
  streamingAgentId: string | null

  // Actions
  addMessage: (msg: ChatMessage) => void
  appendStreamDelta: (delta: string) => void
  appendThinkingDelta: (delta: string) => void
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
