// =============================================================
// feishu-bot/reply — 按消息 ID 回复飞书消息(H2 业务返回码检查)
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { log } from '../../utils/logger'
import { REPLY_CHAR_LIMIT } from './constants'

/** 按消息 ID 回复(用户在飞书看到的是对话流式回复) */
export async function sendReply(
  sdkClient: lark.Client | null,
  messageId: string,
  text: string,
): Promise<void> {
  if (!sdkClient) {
    log('warn', 'feishu-bot', 'sdkClient missing, cannot reply')
    return
  }
  const truncated =
    text.length > REPLY_CHAR_LIMIT ? `${text.slice(0, REPLY_CHAR_LIMIT)}\n…(已截断)` : text
  try {
    // H2 修复: 检查飞书业务返回码 — 缺权限/限流/消息过期等失败会 resolve(code!==0)
    // 而非 throw,此前一律记为"reply sent",失败被静默吞掉
    const res = (await sdkClient.im.message.reply({
      data: {
        content: JSON.stringify({ text: truncated }),
        msg_type: 'text',
      },
      path: { message_id: messageId },
    })) as { code?: number; msg?: string }
    if (res && typeof res.code === 'number' && res.code !== 0) {
      log('error', 'feishu-bot', `reply rejected by feishu: code=${res.code} msg=${res.msg ?? ''}`)
      return
    }
    log('info', 'feishu-bot', `reply sent (${truncated.length} chars)`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'feishu-bot', `reply failed: ${msg}`)
  }
}
