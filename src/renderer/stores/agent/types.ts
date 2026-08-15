// =============================================================
// Agent Store 类型定义 — 状态更新事件 / 状态与 Actions
// =============================================================

import type { AgentDetail, AgentExecution, AgentListItem, AgentStatusPayload } from '@shared/types'
import type { StoreApi } from 'zustand'

/**
 * F4 修复: IPC_AGENT_STATUS_UPDATE 负载统一引用 shared/types/agent.ts 的 AgentStatusPayload,
 * 与 main 侧 status-tracking.ts 发送的字段契约一致(含 aborted 可选标记)。
 */
export type AgentStatusUpdate = AgentStatusPayload

export interface AgentState {
  agents: AgentListItem[]
  loading: boolean
  selectedAgentId: string | null
  selectedDetail: AgentDetail | null
  detailLoading: boolean
  liveOutput: string
  liveToolCalls: Array<{ name: string; args: unknown; time: number }>
  isRunning: boolean
  lastExecution: AgentExecution | null
  lastError: string | null

  // Actions
  fetchAgents: () => Promise<void>
  toggleAgent: (id: string, enabled: boolean) => Promise<void>
  updateAgent: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      modelTier: 'high_quality' | 'low_cost'
      capabilities: string[]
      mcpServers: string[]
    }>,
  ) => Promise<void>
  selectAgent: (id: string | null) => Promise<void>
  refreshDetail: () => Promise<void>
  runAgent: (id: string, prompt: string) => Promise<void>
  abortAgent: (id: string) => Promise<void>
  saveSoul: (id: string, content: string) => Promise<void>
  saveRules: (id: string, content: string) => Promise<void>
  clearOutput: () => void

  // 内部
  _handleStatusUpdate: (data: AgentStatusUpdate) => void
  _unsubscribeStatus: (() => void) | null
  _statusListeners: Set<(data: AgentStatusUpdate) => void>
  initStatusListener: () => void
  /**
   *派生订阅入口 — 让其他 store /组件订阅 agent状态变化,
   * 而不必各自调用 getAPI().agent.onStatusUpdate,避免重复订阅。
   * agentStore 是 IPC_AGENT_STATUS_UPDATE 的唯一主订阅者;
   * 其他消费者通过 subscribeStatus 注册回调,事件触发时同步转发
   * (不经过 React批量更新,避免流式事件被合并丢失)。
   */
  subscribeStatus: (fn: (data: AgentStatusUpdate) => void) => () => void
}

/** slice 共用的 set 类型(与 create<AgentState> 回调注入的同型) */
export type AgentSet = StoreApi<AgentState>['setState']
export type AgentGet = StoreApi<AgentState>['getState']
