// =============================================================
// Agent 运行时共享类型（从 agent-service.ts 抽出，纯重构零行为变化）
// =============================================================

import type { Agent, AgentTool } from '@earendil-works/pi-agent-core'

import type { AgentConfig, AgentExecution, AgentStatus } from '@shared/types'

// =============================================================
// Agent 运行时实例（每次执行创建一个）
// =============================================================

interface RunningAgent {
  agent: InstanceType<typeof Agent>
  abortController: AbortController
  agentId: string
  startedAt: number
}

export type { RunningAgent }

/**
 * executeAgentRun 对宿主(AgentService)的依赖契约。
 * 执行流程抽出为纯函数后,原 this 状态访问全部经此接口注入(单向依赖,无循环)。
 */
export interface AgentExecutionDeps {
  getConfig(id: string): AgentConfig | undefined
  setStatus(id: string, status: AgentStatus): void
  setRunning(id: string, running: RunningAgent): void
  deleteRunning(id: string): void
  appendExecution(id: string, execution: AgentExecution): void
  getSoulContent(id: string): string
  getRulesContent(id: string): string
  buildSkillsSection(): string
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  buildAgentTools(config: AgentConfig, id: string): Promise<AgentTool<any>[]>
  isCurrentGeneration(id: string, generation: number): boolean
}
