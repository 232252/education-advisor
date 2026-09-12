// =============================================================
// Agent 相关类型 — 配置 / 列表 / 详情 / 执行记录 / 风险阈值
// =============================================================

import type { TokenUsage } from './ai'

export type AgentStatus = 'idle' | 'running' | 'error'

/**
 * 一次 Agent 运行的触发来源(M0 abort 来源隔离):
 *   - 'ui'      渲染进程聊天/手动运行(用户在界面上发起)
 *   - 'channel' 消息频道(飞书 bot 等,后续钉钉/企微同)
 *   - 'cron'    定时任务/后台上报(escalate_to 的 main 续跑同)
 * UI 侧 abort 只允许中止 'ui' 来源的在途运行;状态事件携带 source
 * 供渲染层过滤(channel/cron 的输出不写入聊天会话)。
 */
export type AgentRunSource = 'ui' | 'channel' | 'cron'

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
  /** 本次运行的触发来源(见 AgentRunSource);缺省视为 'ui'(向后兼容) */
  source?: AgentRunSource
  output?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; isError: boolean; preview?: string }
  result?: AgentExecution
  error?: string
  aborted?: boolean
  /** 上下文压缩已发生(R2+ 可见性,running 事件携带) */
  compacted?: boolean
}

export interface AgentConfig {
  id: string
  name: string
  role: string
  description: string
  enabled: boolean
  modelTier: 'high_quality' | 'low_cost'
  /** cron 表达式数组 */
  schedule: string[]
  /**
   * 与 schedule 平行的任务提示词(yaml 中对象条目的 prompt 字段)。
   * 此前所有定时任务共用"执行 XX 的定时任务"一句泛化提示,agent 只能靠
   * SOUL 自猜任务意图;现在每条 cron 可携带具体指令(缺省回退泛化提示)。
   */
  schedulePrompts?: Array<string | undefined>
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
  status: 'success' | 'error' | 'timeout' | 'aborted'
  /** 实际执行的模型(provider/id) — 降级链回退后与用户设置可能不同,R2+ 可见性 */
  model?: string
}

interface RiskThresholds {
  high: number
  medium: number
  low: number
}
