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

/**
 * 一条 turn 的结束原因。dsh 0.2.1 起是 `{ kind }` 对象
 * （packages/core/session/src/types.ts TurnEndReasonMap），不再是字符串。
 * 仅 kind 为 error/aborted 计入可重试链路。
 */
export type DshTurnEndKind =
  | 'completed'
  | 'aborted'
  | 'blocked'
  | 'error'
  | 'max-tokens'
  | 'interrupted'
  | 'forked'

export interface DshTurnEndReason {
  readonly kind: DshTurnEndKind | (string & {})
  readonly reason?: unknown
  readonly error?: unknown
}

/** 读 kind；兼容 0.1.x 残留的字符串 reason，避免旧会话日志把整轮打成未知。 */
export function dshTurnEndKind(reason: DshTurnEndReason | string | undefined): string {
  if (typeof reason === 'string') return reason
  return reason?.kind ?? ''
}

function failureFacts(
  value: unknown,
): { message?: string; status?: number; code?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  return {
    message: typeof rec.message === 'string' ? rec.message : undefined,
    status: typeof rec.status === 'number' ? rec.status : undefined,
    code: typeof rec.code === 'string' ? rec.code : undefined,
  }
}

/**
 * turn/end 里供应商真正说了什么。连接测试靠这段区分 401 和套餐未开放；
 * 只留 kind 时，界面上全是「dsh turn error」，换模型重试也不会发生。
 */
export function dshTurnFailureText(reason: DshTurnEndReason | string | undefined): string {
  if (!reason || typeof reason === 'string') return typeof reason === 'string' ? reason : ''
  const fromError = failureFacts(reason.error)
  if (fromError) {
    const body = fromError.message || fromError.code || ''
    const status =
      fromError.status !== undefined && !body.includes(String(fromError.status))
        ? String(fromError.status)
        : ''
    return [status, body].filter(Boolean).join(' ')
  }
  if (typeof reason.reason === 'string') return reason.reason
  const nested = failureFacts(reason.reason)
  return nested?.message || nested?.code || ''
}

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
  /** 官方 ToolResultMessage 不带名字，只有 callId。有则用，没有就靠前面的 tool/call 记。 */
  toolName?: string
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
