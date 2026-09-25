// 智能体/模型运行时的类型契约出口。
// 先前从 @earendil-works/pi-agent-core 再导出的类型现已本地定义，
// pi-agent-core 已从依赖中移除。
// pi-ai 的类型再导出保留（其运行时功能仍在使用中）。

// =============================================================
// 本地类型定义（原 @earendil-works/pi-agent-core 再导出）
// =============================================================

import type {
  AssistantMessageEvent,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai/compat'
import type { Static, TSchema } from 'typebox'

/**
 * AgentMessage: 原 pi-agent-core 中的 AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]
 * 本项目未使用 CustomAgentMessages 扩展，因此 AgentMessage 等价于 Message。
 */
export type AgentMessage = Message

/**
 * AgentToolResult: 工具执行结果。
 * 原 pi-agent-core 中定义，引用了 pi-ai 的 TextContent/ImageContent/Usage。
 */
export interface AgentToolResult<T = unknown> {
  content: (TextContent | ImageContent)[]
  details: T
  usage?: Usage
  addedToolNames?: string[]
  terminate?: boolean
}

/**
 * AgentToolUpdateCallback: 工具流式更新回调。
 */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void

/**
 * AgentTool: 工具定义。
 * 原 pi-agent-core 中扩展了 pi-ai 的 Tool，增加了 label / execute 等字段。
 */
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string
  description: string
  parameters: TParameters
  constrainedSampling?:
    | false
    | {
        type: 'json_schema'
        strict: 'prefer' | 'require'
      }
    | {
        type: 'grammar'
        variants: Record<string, string>
      }
  label: string
  prepareArguments?: (args: unknown) => Static<TParameters>
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>
  replay?: 'never' | 'safe'
  executionMode?: 'sequential' | 'parallel'
}

/**
 * AgentEvent: 原 pi-agent-core 中的事件联合类型。
 * DshAgentFacade 通过 DshAgentEventProjector 产生同样形状的事件。
 */
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: 'message_start'; message: AgentMessage }
  | {
      type: 'message_update'
      message: AgentMessage
      assistantMessageEvent: AssistantMessageEvent
    }
  | { type: 'message_end'; message: AgentMessage }
  | {
      type: 'tool_execution_start'
      toolCallId: string
      toolName: string
      args: unknown
    }
  | {
      type: 'tool_execution_update'
      toolCallId: string
      toolName: string
      args: unknown
      partialResult: unknown
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result: unknown
      isError: boolean
    }

/**
 * CompactionSettings: 压缩配置。
 */
export interface CompactionSettings {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

// =============================================================
// pi-ai 类型再导出（保留：其运行时功能仍在 grading/pi-ai 等模块中使用）
// =============================================================

export type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  ModelThinkingLevel,
  TextContent,
  ThinkingLevel,
} from '@earendil-works/pi-ai/compat'
