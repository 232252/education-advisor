// =============================================================
// adapters/feishu/reply — 按消息 ID 回复飞书消息
// (M3 从 feishu-bot/reply.ts 搬入,不变;原文件改为 re-export 壳)
// H2: 检查飞书业务返回码(缺权限/限流/消息过期等失败会 resolve code!==0)
// 阶段 0: 限流(230020/99991400)或网络异常时有限重试一次 —
// ack 已发且 message_id 已去重,回复失败不重试就永久丢了。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { REPLY_CHAR_LIMIT } from './constants'

/** 限流重试等待(ms),参考响应头 x-ogw-ratelimit-reset 的常见量级取保守值 */
const RETRY_DELAY_MS = 800

/** 可重试的飞书业务码(230020 卡片更新限流 / 99991400 通用限流) */
const RETRYABLE_CODES = new Set([230020, 99991400])

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

  for (let attempt = 1; attempt <= 2; attempt++) {
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
        if (attempt === 1 && RETRYABLE_CODES.has(res.code)) {
          log('warn', 'feishu-bot', `reply rate-limited (code=${res.code}), retry once`)
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
          continue
        }
        log(
          'error',
          'feishu-bot',
          `reply rejected by feishu: code=${res.code} msg=${res.msg ?? ''}`,
        )
        return
      }
      log('info', 'feishu-bot', `reply sent (${truncated.length} chars)`)
      return
    } catch (err) {
      // 网络异常:重试一次后放弃
      if (attempt === 1) {
        log('warn', 'feishu-bot', `reply network error: ${errText(err)}, retry once`)
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      log('error', 'feishu-bot', `reply failed: ${errText(err)}`)
      return
    }
  }
}
