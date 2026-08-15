// =============================================================
// Agent 相关类型 — 配置 / 列表 / 详情 / 执行记录 / 风险阈值
// =============================================================

import type { TokenUsage } from './ai'

export type AgentStatus = 'idle' | 'running' | 'error'

/**
 * F4 修复: IPC_AGENT_STATUS_UPDATE 负载的统一契约。
 * 字段以 main 侧 status-tracking.ts 实际发送为准(见 agent-service.ts / agent/execution.ts):
 *   - output: 流式文本增量(text_delta)
 *   - toolCall / toolResult: 工具调用开始/结束
 *   - result: 一次执行的完整 AgentExecution
 *   - error: 错误消息
 *   - aborted: 中止后进入 idle 时标记(agent-service.ts abortAgent 发送 aborted:true)
 * 此前该负载在 status-tracking.ts(弱类型 extras)/ renderer stores 三处手写,现统一引用本类型。
 */
export interface AgentStatusPayload {
  agentId: string
  status: AgentStatus
  output?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; isError: boolean }
  result?: AgentExecution
  error?: string
  aborted?: boolean
}

export interface AgentConfig {
  id: string
  name: string
  role: string
  description: string
  enabled: boolean
  modelTier: 'high_quality' | 'low_cost'
  schedule: string[]
  capabilities: string[]
  riskThresholds?: RiskThresholds
  /** MCP 集成:该 Agent 启用的全局 MCP server ID 列表 */
  mcpServers?: string[]
}

export interface AgentListItem extends AgentConfig {
  status: AgentStatus
  lastRunAt?: number
  nextRunAt?: number
}

export interface AgentDetail extends AgentListItem {
  soulContent: string
  rulesContent: string
  executionHistory: AgentExecution[]
}

export interface AgentExecution {
  id: string
  agentId: string
  prompt: string
  output: string
  startedAt: number
  durationMs: number
  tokenUsage: TokenUsage
  cost: number
  status: 'success' | 'error' | 'timeout'
}

export interface RiskThresholds {
  high: number
  medium: number
  low: number
}
