// =============================================================
// AI / LLM 相关类型 — provider / 模型 / 流式事件 / 用量
// =============================================================

export interface ProviderInfo {
  id: string
  name: string
  supportsOAuth: boolean
  hasApiKey: boolean
  modelCount: number
  customBaseUrl?: string
  hidden?: boolean
  /** 该 provider 下存在 $0 免费（input+output 均 0 成本）模型 */
  hasFreeModels?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  providerId: string
  api: string
  contextWindow: number
  maxOutputTokens: number
  costPerInputToken: number
  costPerOutputToken: number
  costCacheRead: number
  costCacheWrite: number
  supportsReasoning: boolean
  baseUrl: string
  isCustom?: boolean
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

type StreamEventBase =
  | { type: 'start'; model: string; provider: string }
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end' }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'toolcall_start'; id: string; name: string }
  | { type: 'toolcall_delta'; id: string; argsDelta: string }
  | { type: 'toolcall_end'; id: string }
  | { type: 'done'; usage: TokenUsage; cost: number }
  | { type: 'error'; message: string; retryable: boolean; retry?: RetryPolicyInfo }
  | {
      type: 'retry'
      attempt: number
      maxRetries: number
      delayMs: number
      reason: string
    }

/** F1: sessionId 由主进程 chat handler 推送时注入,渲染端据此过滤本请求的流事件 */
export type StreamEvent = StreamEventBase & { sessionId?: string }

/** 重试策略信息(从 settings.models.retry.* 读,附在 error 事件上供渲染端展示) */
export interface RetryPolicyInfo {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
  providerTimeoutMs: number
  shouldRetry: boolean
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
