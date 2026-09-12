// =============================================================
// adapters/wecom/reply-session — respond-stream 三态会话
// 企微流式语义与飞书/钉钉不同: 无独立 update API,而是在同一回调的
// req_id 上反复发 aibot_respond_msg,stream.id 不变、content 为全量文本,
// finish=true 结束;首次发送起 10 分钟硬窗口(STREAM_WINDOW_MS),
// Bridge 侧提前强制收尾(超窗后 respond 直接失败,用户会失联)。
// 幂等: finalize/fail 仅首次生效。
// =============================================================

import type { ReplySession } from '@shared/types'
import { log } from '../../../../utils/logger'
import {
  STREAM_UPDATE_INTERVAL_MS,
  STREAM_WINDOW_GUARD_MS,
  STREAM_WINDOW_MS,
  WECOM_CMD,
} from './constants'

export interface WecomReplySessionDeps {
  /** 发送协议帧(cmd + reqId + body) */
  sendCommand: (cmd: string, reqId: string, body: Record<string, unknown>) => void
  /** 回调帧 req_id(回复透传) */
  reqId: string
  /** 注入时钟(测试);缺省 Date.now */
  now?: () => number
}

function streamId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 创建企微流式回复会话并立即发出占位帧(秒回,即流式首帧)。
 * 失败不抛错(发送错误由 ws-client 记日志),会话仍然可用。
 */
export function createWecomReplySession(
  deps: WecomReplySessionDeps,
  placeholderText: string,
): ReplySession {
  const id = streamId()
  const now = deps.now ?? Date.now
  let finished = false
  let latestText = placeholderText
  let lastSent = placeholderText
  let firstSentAt = now()
  let timer: ReturnType<typeof setTimeout> | null = null
  // 发送串行链: 同 req_id 的帧按序发出(ws 层尚有网络缓冲,此处仅保生成顺序)
  let chain: Promise<void> = Promise.resolve()

  const sendStream = (content: string, finish: boolean): void => {
    chain = chain
      .catch(() => {})
      .then(() => {
        deps.sendCommand(WECOM_CMD.RESPONSE, deps.reqId, {
          msgtype: 'stream',
          stream: { id, finish, content },
        })
      })
  }

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (finished || latestText === lastSent) return
    lastSent = latestText
    sendStream(latestText, false)
  }

  const finalizeWith = (text: string, prefix?: string): void => {
    if (firstSentAt === 0) firstSentAt = now()
    sendStream(text, true)
    if (prefix) log('info', 'wecom', `stream finalized (${prefix}, ${text.length} chars)`)
  }

  // 秒回占位(流式首帧;官方语义: respond 首帧打开会话)
  sendStream(placeholderText, false)

  // 10 分钟硬窗口守卫: 到点强制以当前累计文本收尾,追加截断说明
  const windowGuard = setTimeout(() => {
    if (finished) return
    finished = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    finalizeWith(
      `${latestText}\n\n(已达企微流式 10 分钟上限,输出到此截断;重新发送消息可继续)`,
      'stream-window-guard',
    )
  }, STREAM_WINDOW_MS - STREAM_WINDOW_GUARD_MS)

  return {
    update(fullText: string): Promise<void> {
      if (finished) return Promise.resolve()
      if (firstSentAt === 0) firstSentAt = now()
      latestText = fullText
      if (timer) return Promise.resolve()
      timer = setTimeout(flush, STREAM_UPDATE_INTERVAL_MS)
      return Promise.resolve()
    },
    async finalize(finalText: string): Promise<void> {
      if (finished) return
      finished = true
      clearTimeout(windowGuard)
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      finalizeWith(finalText || '(完成)', 'finalize')
    },
    async fail(errorText: string): Promise<void> {
      if (finished) return
      finished = true
      clearTimeout(windowGuard)
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      finalizeWith(errorText, 'fail')
    },
  }
}
