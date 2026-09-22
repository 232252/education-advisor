// =============================================================
// dsh 运行时 wire 类型（@deepseek-ai/dsh-sdk-protocol 的应用侧镜像）
//
// 只声明本仓库用到的子集。刻意不 import alpha 包：dsh 公开 API 处于
// pre-stable（README:「THERE WILL BE COMPATIBILITY-BREAKING CHANGES」），
// 编译期依赖会在每次 alpha 漂移时打断构建；跨进程边界只做结构兼容。
// 上游定义见 packages/core/session/src/types.ts 与 packages/llm/llm/src。
// =============================================================

/** dsh usage 无 cost 字段（pi-ai 有 usage.cost.total） */
export interface DshTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** 一条 turn 的结束原因；仅 error/aborted 计入可重试链路 */
export type DshTurnEndReason = 'completed' | 'aborted' | 'blocked' | 'error' | 'interrupted'

/** 压缩后的模型流分片（delta 边界不合并，故 texts/args 是数组） */
export type DshAssistantStreamRecord =
  | { readonly type: 'text-chunks'; readonly texts: readonly string[] }
  | { readonly type: 'reasoning-chunks'; readonly texts: readonly string[] }
  | {
      readonly type: 'tool-call-chunks'
      readonly id: string
      readonly name?: string
      readonly args: readonly string[]
    }
  | {
      readonly type: 'chunk'
      readonly chunk:
        | { type: 'text-delta'; text?: string }
        | { type: 'reasoning-delta'; text?: string }
        | { type: 'tool-call-delta' }
        | { type: 'block-start' }
        | { type: 'block-end' }
        | { type: 'finish' }
        | { type: 'usage'; usage?: DshTokenUsage }
    }

export interface DshToolResultMessage {
  toolCallId: string
  toolName: string
  content: unknown[]
  details?: unknown
  isError?: boolean
}

export interface DshAssistantMessage {
  readonly turn: number
  readonly step: number
  readonly stream: readonly DshAssistantStreamRecord[]
  readonly usage?: DshTokenUsage
  readonly interrupted?: true
}

/**
 * SessionEventMap 中本仓库理解的成员。
 *
 * 刻意做成闭合联合：带 `{ type: string }` 兜底成员会让 TS 的判别式收窄失效
 * （assistant/message 同时匹配兜底，data 退化成 unknown）。插件可扩展出
 * 其它事件类型，由接入层在跨进程边界处 cast，映射函数对未知 type 走 default。
 */
export type DshSessionEvent =
  | { type: 'assistant/message'; data: DshAssistantMessage }
  | { type: 'assistant/attempt'; data: { stream: readonly DshAssistantStreamRecord[] } }
  | {
      type: 'tool/call'
      data: { callId: string; name: string; arguments: string }
    }
  | {
      type: 'tool/result'
      data: {
        message?: DshToolResultMessage
        error?: { name: string; code: string; reason?: string }
      }
    }
  | { type: 'turn/end'; data: { turn: number; reason: DshTurnEndReason } }

/** SDK `session.event` 通知载荷 */
export interface DshSessionEventNotification {
  sessionId: string
  event: DshSessionEvent
}
