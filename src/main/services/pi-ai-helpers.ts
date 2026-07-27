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
import type { ModelInfo, StreamEvent } from '../../shared/types'

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
      return {
        type: 'error',
        message: msg.errorMessage ?? 'Unknown error',
        retryable: event.reason === 'aborted',
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
 * 判定一个错误消息是否属于"可重试"类型(网络/限流/5xx)。
 * 从 pi-ai-service.ts chatStream 的 catch 块提取,
 * 用于决定是否对失败请求做指数退避重试。
 *
 * 注意:原始实现使用大小写敏感的 includes(非 toLowerCase),
 * 为保持行为一致这里也保留大小写敏感——例如 "ECONNRESET" 匹配但
 * "econnreset" 不匹配。这是历史行为,测试应覆盖大写形式。
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
    message.includes('ECONNREFUSED')
  )
}
