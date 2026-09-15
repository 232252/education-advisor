// =============================================================
// adapters/weixin/reply-session — 无流式;finalize 文本+图片/文件;停 typing
// =============================================================

import type { OutboundMediaRef, ReplySession } from '@shared/types'
import type { ILinkClient } from './ilink-client'
import { sendWeixinOutbound } from './outbound'
import type { WeixinDeliveryInfo } from './parsing'
import type { TypingStopFn } from './typing'

export function createWeixinReplySession(
  client: ILinkClient,
  delivery: WeixinDeliveryInfo,
  media: OutboundMediaRef[] = [],
  onDone?: TypingStopFn,
): ReplySession {
  let finished = false
  let lastText = ''

  const done = () => {
    try {
      onDone?.(true)
    } catch {
      /* ignore */
    }
  }

  return {
    async update(fullText: string) {
      if (finished) return
      lastText = fullText
      // streamingKind=none: 不中途推送
    },
    async finalize(finalText: string) {
      if (finished) return
      finished = true
      try {
        const text = (finalText || lastText || '').trim()
        if (!text && media.length === 0) return
        await sendWeixinOutbound(client, delivery, text, media)
      } finally {
        done()
      }
    },
    async fail(errorText: string) {
      if (finished) return
      finished = true
      try {
        const text = (errorText || '处理失败,请稍后重试').trim()
        await client.sendText(delivery.toUserId, text, delivery.contextToken)
      } catch {
        /* 失败收尾尽力 */
      } finally {
        done()
      }
    },
  }
}
