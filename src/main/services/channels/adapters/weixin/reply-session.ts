// =============================================================
// adapters/weixin/reply-session — 微信无流式;update 忽略,finalize 一次性发送
// =============================================================

import type { ReplySession } from '@shared/types'
import type { ILinkClient } from './ilink-client'
import type { WeixinDeliveryInfo } from './parsing'

export function createWeixinReplySession(
  client: ILinkClient,
  delivery: WeixinDeliveryInfo,
): ReplySession {
  let finished = false
  let lastText = ''

  return {
    async update(fullText: string) {
      if (finished) return
      lastText = fullText
      // streamingKind=none: 不中途推送
    },
    async finalize(finalText: string) {
      if (finished) return
      finished = true
      const text = (finalText || lastText || '').trim()
      if (!text) return
      await client.sendText(delivery.toUserId, text, delivery.contextToken)
    },
    async fail(errorText: string) {
      if (finished) return
      finished = true
      const text = (errorText || '处理失败,请稍后重试').trim()
      try {
        await client.sendText(delivery.toUserId, text, delivery.contextToken)
      } catch {
        /* 失败收尾尽力 */
      }
    },
  }
}
