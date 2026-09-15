// =============================================================
// adapters/feishu/reactions — Typing/DONE 表情(QwenPaw 无 typing API 时的标准做法)
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { getFeishuBase } from './http-instance'

type TokenGetter = () => Promise<string | null>

/**
 * 非阻塞加表情。优先走 SDK;失败时用 Open API fallback。
 * emojiType 常用: Typing / DONE(与 QwenPaw 一致)。
 */
export function addMessageReaction(
  sdkClient: lark.Client | null,
  messageId: string,
  emojiType: string,
  getAccessToken?: TokenGetter,
): void {
  if (!messageId) return
  void (async () => {
    try {
      if (sdkClient) {
        const im = sdkClient.im as unknown as {
          messageReaction?: {
            create: (req: unknown) => Promise<{ code?: number; msg?: string }>
          }
        }
        if (im.messageReaction?.create) {
          const res = await im.messageReaction.create({
            path: { message_id: messageId },
            data: { reaction_type: { emoji_type: emojiType } },
          })
          if (typeof res?.code === 'number' && res.code !== 0) {
            log(
              'debug',
              'feishu-bot',
              `reaction ${emojiType} failed: code=${res.code} msg=${res.msg ?? ''}`,
            )
          }
          return
        }
      }
      if (!getAccessToken) return
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(
        `${getFeishuBase()}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
          signal: AbortSignal.timeout(10_000),
        },
      )
      const json = (await res.json()) as { code?: number; msg?: string }
      if (json.code !== 0) {
        log('debug', 'feishu-bot', `reaction ${emojiType} http failed: code=${json.code}`)
      }
    } catch (err) {
      log('debug', 'feishu-bot', `reaction ${emojiType} error: ${errText(err)}`)
    }
  })()
}
