// =============================================================
// adapters/qq/reply-session — streamingKind=none: finalize 一次性回复
// =============================================================

import type { ReplySession } from '@shared/types'
import type { QqApiClient } from './api'
import type { QqDeliveryInfo } from './parsing'

export function createQqReplySession(api: QqApiClient, delivery: QqDeliveryInfo): ReplySession {
  let finished = false
  let lastText = ''
  return {
    async update(fullText: string) {
      if (finished) return
      lastText = fullText
    },
    async finalize(finalText: string) {
      if (finished) return
      finished = true
      const text = (finalText || lastText || '').trim()
      if (!text) return
      await api.replyText(delivery, text)
    },
    async fail(errorText: string) {
      if (finished) return
      finished = true
      try {
        await api.replyText(delivery, (errorText || '处理失败').trim())
      } catch {
        /* ignore */
      }
    },
  }
}
