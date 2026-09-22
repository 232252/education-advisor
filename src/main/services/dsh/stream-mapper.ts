// =============================================================
// dsh SessionEvent → 前端 StreamEvent
//
// 与 pi-ai-helpers.mapEvent 同一出口契约（@shared/types/ai），因此渲染端、
// IPC 推送与 sessionId 过滤逻辑无需感知后端切换。
//
// 差异说明：
// - dsh 没有逐 token 的 live 事件；文本/思考增量来自 assistant/message 内
//   压缩过的 stream 记录（上游刻意「不合并 delta 边界」）。
// - 工具调用以 tool/call 事件为准（带 callId + 完整 arguments），stream 里的
//   tool-call-chunks 忽略，避免同一次调用发两遍。
// - dsh 的 usage 没有 cost 字段，done.cost 固定 0（pi-ai 路径有 cost.total）。
// =============================================================

import type { StreamEvent, TokenUsage } from '@shared/types/ai'
import type { DshAssistantStreamRecord, DshSessionEvent, DshTokenUsage } from './wire-types'

/**
 * turn/end 失败原因的机器可读标识：StreamEvent.error 只有 message 字段，
 * 消费方（批改链路用它还原 stopReason='aborted'）依赖这两个字面量，勿改。
 */
export const DSH_TURN_ABORTED = 'dsh turn aborted'
export const DSH_TURN_ERROR = 'dsh turn error'

/** usage 缺失时按全 0，与 mapEvent 的 `?? 0` 口径一致 */
function toUsage(usage: DshTokenUsage | undefined): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
  }
}

/** 压缩分片 → 增量事件；一组文本/思考各自带 start/end 包裹 */
function mapStreamRecords(records: readonly DshAssistantStreamRecord[]): StreamEvent[] {
  const out: StreamEvent[] = []
  for (const record of records) {
    if (record.type === 'text-chunks') {
      out.push({ type: 'text_start' })
      for (const text of record.texts) out.push({ type: 'text_delta', delta: text })
      out.push({ type: 'text_end' })
    } else if (record.type === 'reasoning-chunks') {
      out.push({ type: 'thinking_start' })
      for (const text of record.texts) out.push({ type: 'thinking_delta', delta: text })
      out.push({ type: 'thinking_end' })
    } else if (record.type === 'chunk') {
      const chunk = record.chunk
      if (chunk.type === 'text-delta' && chunk.text) {
        out.push({ type: 'text_delta', delta: chunk.text })
      } else if (chunk.type === 'reasoning-delta' && chunk.text) {
        out.push({ type: 'thinking_delta', delta: chunk.text })
      }
    }
    // tool-call-chunks / block-start / block-end / finish / usage：由结构化事件承载
  }
  return out
}

/**
 * 单条 dsh SessionEvent → 0..n 个 StreamEvent。
 * 未识别的事件类型返回空数组（SessionEventMap 可被插件合并扩展，
 * 新增成员不应打断投影）。
 */
export function mapDshSessionEvent(event: DshSessionEvent): StreamEvent[] {
  switch (event.type) {
    case 'assistant/message': {
      const out = mapStreamRecords(event.data.stream)
      // 被中断的 turn 也要收尾，否则渲染端停在 streaming 态
      out.push({ type: 'done', usage: toUsage(event.data.usage), cost: 0 })
      return out
    }

    case 'tool/call': {
      const { callId, name, arguments: args } = event.data
      return [
        { type: 'toolcall_start', id: callId, name },
        { type: 'toolcall_delta', id: callId, argsDelta: args },
        { type: 'toolcall_end', id: callId },
      ]
    }

    case 'tool/result': {
      const err = event.data.error
      return err
        ? [
            {
              type: 'error',
              message: err.reason ?? err.name,
              retryable: false,
            },
          ]
        : []
    }

    case 'turn/end': {
      const reason = event.data.reason
      // 与 pi 链路同源：aborted 可重试；error 交给上层重试策略
      if (reason === 'aborted' || reason === 'error') {
        return [
          {
            type: 'error',
            message: reason === 'aborted' ? DSH_TURN_ABORTED : DSH_TURN_ERROR,
            retryable: true,
          },
        ]
      }
      return []
    }

    default:
      return []
  }
}
