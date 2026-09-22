// =============================================================
// Agent 运行时共享类型（从 agent-service.ts 抽出，纯重构零行为变化）
// =============================================================

import type { AgentEvent, AgentMessage, AgentTool } from '@main/services/llm-contracts'

import type { AgentConfig, AgentExecution, AgentRunSource, AgentStatus } from '@shared/types'
import type { BrowserWindow } from 'electron'
import type { PrivacyGuard } from './privacy-guard'

// ===========================================================
// Agent 运行时实例（每次执行创建一个）
// ===========================================================

/**
 * execution 链路真正用到的最小面（六个成员）。
 * pi 的 Agent 与 dsh 替身 DshAgentFacade 都结构上满足它，
 * 于是后端切换只需要换一个构造结果。
 */
export interface AgentRuntimeLike {
  state: { tools: readonly unknown[]; messages: AgentMessage[] }
  subscribe(handler: (event: AgentEvent) => void): () => void
  /** 返回类型取 unknown：pi 的 abort 返回 void、dsh 替身返回 Promise，两者都可 await */
  prompt(text: string): unknown
  waitForIdle(): Promise<void>
  abort(): unknown
}

interface RunningAgent {
  agent: AgentRuntimeLike
  abortController: AbortController
  agentId: string
  startedAt: number
  /** M0: 本次运行来源 — abortAgent 据此隔离 UI abort(ui 以外不允许被 UI 误杀) */
  source: AgentRunSource
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
  /** 全角色公共规则(agents/_shared/rules.md),M10: 公共段单点维护统一注入 */
  getSharedRulesContent(): string
  /** 项目级背景知识(agents/_shared/project-context.md),让 AI 认知整个系统 */
  getProjectContextContent(): string
  /** 技能清单段(按该 agent capabilities 过滤,见 agent/tools.ts) */
  buildSkillsSection(capabilities: string[]): string
  // M32: win 用于 delegate_to 委托运行的状态推送(仅 main 会注入该工具)
  // privacyGuard: 开启自动脱敏的运行传入,用于包装 EAA 工具(见 agent/privacy-guard.ts)
  // visionEnabled: P2-8 — 模型具备视觉输入时注入 read_image(见 agent/tools.ts)
  buildAgentTools(
    config: AgentConfig,
    id: string,
    win?: BrowserWindow,
    privacyGuard?: PrivacyGuard,
    visionEnabled?: boolean,
    // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  ): Promise<AgentTool<any>[]>
  isCurrentGeneration(id: string, generation: number): boolean
}
