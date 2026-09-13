// =============================================================
// pi-ai-helpers — 从 pi-ai-service.ts 提取的纯函数
//
// 这些函数没有 I/O、没有单例状态、不依赖 pi-ai 运行时,
// 可以被 Vitest 直接单元测试(无需 mock)。
// 提取的目的:让 LLM 编排核心(pi-ai-service.ts)里的纯逻辑
// 拥有测试覆盖,而不是被埋在 1093 行的大文件里。
// =============================================================

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
} from '@earendil-works/pi-ai/compat'
import type { ModelInfo, StreamEvent } from '@shared/types'

/**
 * 按 id 去重模型列表(保留第一个出现)。
 * @example dedupeModels([{id:'a'},{id:'b'},{id:'a'}]) → [{id:'a'},{id:'b'}]
 */
export function dedupeModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  return models.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}

/**
 * 计算单个模型的成本分数(input + output 成本之和)。
 * 缺失/非有限值视为 Infinity(降权到末尾)。
 */
export function costScore(m: Model<Api>): number {
  const input = Number.isFinite(m.cost?.input) ? m.cost.input : Number.POSITIVE_INFINITY
  const output = Number.isFinite(m.cost?.output) ? m.cost.output : Number.POSITIVE_INFINITY
  return input + output
}

/**
 * 从模型列表中选择最便宜(成本分数最低)的模型。
 * 空列表抛错(调用方在 testConnection 中已保证非空)。
 */
export function selectCheapestModel(models: Model<Api>[]): Model<Api> {
  if (models.length === 0) {
    throw new Error('selectCheapestModel: empty model list')
  }
  const score = costScore
  return models.reduce((cheapest, m) => (score(m) < score(cheapest) ? m : cheapest))
}

/**
 * 套餐配额 SKU:目录里标价为 0,但只对特定订阅开放。
 * 智谱 Highspeed 即此类——连接测试若选它,普通套餐会 429/1311。
 */
export function isQuotaGatedProbeModel(model: { id: string; name?: string }): boolean {
  return /high[\s_-]*speed/i.test(`${model.id} ${model.name ?? ''}`)
}

/**
 * 连接探测候选:排除套餐专属模型后按成本升序。
 * 若全部都是套餐专属,回退到全量列表,避免无模型可测。
 */
export function rankProbeModels(models: Model<Api>[]): Model<Api>[] {
  const eligible = models.filter((m) => !isQuotaGatedProbeModel(m))
  const pool = eligible.length > 0 ? eligible : models
  return pool.slice().sort((a, b) => costScore(a) - costScore(b))
}

/** 连接测试用探测模型(最便宜的非套餐专属)。空列表抛错。 */
export function selectProbeModel(models: Model<Api>[]): Model<Api> {
  const ranked = rankProbeModels(models)
  if (ranked.length === 0) {
    throw new Error('selectProbeModel: empty model list')
  }
  return ranked[0]
}

/** 密钥本身无效,换模型重试没有意义。 */
export function isAuthRejectedError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    /\b401\b/.test(message) ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication failed')
  )
}

/** 当前探测模型对这张密钥的套餐未开放,可换更便宜/更通用的模型再试。 */
export function isModelPlanDeniedError(message: string): boolean {
  return (
    message.includes('1311') ||
    message.includes('暂未开放') ||
    (message.includes('套餐') && message.includes('权限')) ||
    /does not have access/i.test(message) ||
    /not available.*(plan|subscription|your)/i.test(message)
  )
}

/**
 * 将 pi-ai 的 AssistantMessageEvent 映射为前端 StreamEvent。
 * - `start` 事件返回 null(chatStream 中手动 yield,避免重复)
 * - `error` 事件的 retryable 仅在 reason === 'aborted' 时为 true
 * - `done` 事件把 pi-ai 的 usage 字段映射成 TokenUsage
 * - 未知事件类型返回 null
 */
export function mapEvent(event: AssistantMessageEvent): StreamEvent | null {
  switch (event.type) {
    case 'start':
      return null

    case 'text_start':
      return { type: 'text_start' }

    case 'text_delta':
      return { type: 'text_delta', delta: event.delta }

    case 'text_end':
      return { type: 'text_end' }

    case 'thinking_start':
      return { type: 'thinking_start' }

    case 'thinking_delta':
      return { type: 'thinking_delta', delta: event.delta }

    case 'thinking_end':
      return { type: 'thinking_end' }

    case 'toolcall_start': {
      const tc = extractPartialToolCall(event.partial, event.contentIndex)
      return tc ? { type: 'toolcall_start', id: tc.id, name: tc.name } : null
    }

    case 'toolcall_delta':
      return { type: 'toolcall_delta', id: '', argsDelta: event.delta }

    case 'toolcall_end':
      return { type: 'toolcall_end', id: event.toolCall.id }

    case 'done': {
      const msg = event.message
      const usage = msg.usage
      return {
        type: 'done',
        usage: {
          inputTokens: usage?.input ?? 0,
          outputTokens: usage?.output ?? 0,
          cacheReadTokens: usage?.cacheRead ?? 0,
          cacheWriteTokens: usage?.cacheWrite ?? 0,
        },
        cost: usage?.cost?.total ?? 0,
      }
    }

    case 'error': {
      const msg = event.error
      // P2-9 口径统一: 可重试 = 网络类错误(isRetryableError) 或流被 abort
      // (与 agent 链路 retrying-stream 的重试判定同源;此前仅看 reason==='aborted',
      // 流内 429/超时/网络错误在直连路径不带重试提示,两链路行为分裂)
      return {
        type: 'error',
        message: msg.errorMessage ?? 'Unknown error',
        retryable: event.reason === 'aborted' || isRetryableError(msg.errorMessage ?? ''),
      }
    }

    default:
      return null
  }
}

/**
 * 从 partial AssistantMessage 中提取指定 contentIndex 处的 toolCall 信息。
 * 越界、非 toolCall 块返回 null。
 */
export function extractPartialToolCall(
  partial: AssistantMessage,
  contentIndex: number,
): { id: string; name: string } | null {
  const block = partial.content[contentIndex]
  if (block && block.type === 'toolCall') {
    return { id: block.id, name: block.name }
  }
  return null
}

/**
 * 零用量 usage(占位 AssistantMessage 构造共用)。
 * 每次返回全新对象,避免多个消息共享同一可变引用。
 */
export function zeroedUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/**
 * 构造最小合法的 AssistantMessage(纯文本占位回复)。
 * 用于对话历史注入 / 压缩上下文构造:让 pi-ai 识别"这是之前的助手回复",
 * 只保留 role/content/model 元信息,usage 全零。
 */
export function createAssistantPlaceholder(
  text: string,
  model: Pick<Model<Api>, 'api' | 'provider' | 'id'>,
  timestamp: number,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroedUsage(),
    stopReason: 'stop',
    timestamp,
  }
}

/**
 * 指数退避延迟: baseDelay * 2^attempt + 随机 jitter(0-99ms)。
 * Chat 与 Agent 两条流式链路的重试共用同一公式。
 */
export function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100)
}

/**
 * 判定一个错误消息是否属于"可重试"类型(网络/限流/5xx)。
 * 从 pi-ai-service.ts chatStream 的 catch 块提取,
 * 用于决定是否对失败请求做指数退避重试。
 *
 * 注意:原始实现使用大小写敏感的 includes(非 toLowerCase),
 * 为保持行为一致这里也保留大小写敏感——例如 "ECONNRESET" 匹配但
 * "econnreset" 不匹配。这是历史行为,测试应覆盖大写形式。
 *
 * P0-2(2026-09-13 深查)扩口径,两条新匹配刻意跨大小写:
 *   - 'Request was aborted': 首字节超时 abort 的 reason 在部分 SDK 路径下
 *     会被替换为该文案(09-13 22:05 挂死 180s 一次重试都没发生的原因)。
 *     用户主动停止不会误重试 — 调用方(retrying-stream/streaming)均以
 *     signal.aborted 门先行拦截。
 *   - /timed?\s*out/i: openai SDK 超时文案为 "Request timed out."(含空格),
 *     历史的 includes('timeout') 匹配不到。
 */
export function isRetryableError(message: string): boolean {
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED') ||
    message.includes('Request was aborted') ||
    /timed?\s*out/i.test(message)
  )
}
