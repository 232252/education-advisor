// =============================================================
// adapters/qq/reply-session — streamingKind=none: finalize 一次性回复
// 支持文本 + 显式/标记富媒体([IMAGE:path] / [FILE:path])
// =============================================================

import type { OutboundMediaRef, ReplySession } from '@shared/types'
import type { QqApiClient } from './api'
import type { QqDeliveryInfo } from './parsing'

export function createQqReplySession(
  api: QqApiClient,
  delivery: QqDeliveryInfo,
  media: OutboundMediaRef[] = [],
): ReplySession {
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
      if (!text && media.length === 0) return
      await api.replyOutbound(delivery, text, media)
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
