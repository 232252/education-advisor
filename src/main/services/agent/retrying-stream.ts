// =============================================================
// Agent 链路的带重试 streamFn(R2+ 流畅度/可靠性审计)
//
// 背景: models.retry.* 的完整重试(指数退避/首字节超时)只接在
// ChatStreamRunner(学业页用的直连路径)上;Agent 对话走的 streamSimple
// 此前裸奔 — 一次 429/网络抖动直接把英文原文错误甩给用户。
//
// 策略(与 ChatStreamRunner 对齐的 80/20 版):
//   仅重试「建流阶段」的失败 — streamSimple(model, ctx) 建流时即发出
//   HTTP 请求,429/401/超时/网络错误都在此阶段抛出;
//   建流成功后原样返回原始 AssistantMessageEventStream,不包装不转发
//   (已开始输出后失败不重试,避免重复输出 — 与 ChatStreamRunner 同口径)。
// =============================================================

import { streamSimple } from '@earendil-works/pi-ai/compat'
import { isRetryableError } from '../pi-ai-helpers'
import { settingsService } from '../settings-service'

interface RetrySettings {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
}

function readRetrySettings(): RetrySettings {
  // 默认值与 ChatStreamRenderer/直连路径一致: enabled/3 次/1000ms 起步
  const s: RetrySettings = { enabled: true, maxRetries: 3, baseDelayMs: 1000 }
  try {
    const r = settingsService.getSettings().models?.retry
    if (r) {
      if (typeof r.enabled === 'boolean') s.enabled = r.enabled
      if (typeof r.maxRetries === 'number' && r.maxRetries >= 0) s.maxRetries = r.maxRetries
      if (typeof r.baseDelayMs === 'number' && r.baseDelayMs > 0) s.baseDelayMs = r.baseDelayMs
    }
  } catch {
    /* settings 不可用时用默认值 */
  }
  return s
}

/** 构造带建流重试的 streamFn — 在 execution.ts 替代裸 streamSimple 注入 Agent */
export function createRetryingStreamFn() {
  return async (...args: Parameters<typeof streamSimple>) => {
    const { enabled, maxRetries, baseDelayMs } = readRetrySettings()
    let attempt = 0
    while (true) {
      try {
        return await streamSimple(...args)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const canRetry = enabled && isRetryableError(message) && attempt < maxRetries
        if (!canRetry) throw err
        const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100)
        attempt++
        console.log(
          `[Agent] stream creation retry ${attempt}/${maxRetries} after ${delay}ms (error: ${message})`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}
