// =============================================================
// adapters/dingtalk/reply-session — 钉钉回复会话
// 与飞书 reply-session 同构的三态会话(update/finalize/fail 幂等):
//   1. 创建 AI 卡片(官方公共模板)+ 投放到会话 → 秒回占位
//   2. update 全量文本 → 首帧切 INPUTING(打字机),900ms 节流发 streaming 帧
//   3. finalize → isFinalize 终帧 + FINISHED 状态;fail → FAILED 状态
// 任一卡片环节失败(无权限/模板失效/接口异常)→ 降级 sessionWebhook
// 纯文本(占位静默,终稿一次性发送),与飞书降级链语义一致。
// =============================================================

import type { ReplySession } from '@shared/types'
import { log } from '../../../../utils/logger'
import type { DingtalkApiClient } from './api'
import { normalizeForCard, streamFrameContent } from './card-format'
import { AI_CARD_STATUS, STREAM_UPDATE_INTERVAL_MS } from './constants'
import type { DingtalkDeliveryInfo } from './parsing'

export interface DingtalkReplySessionDeps {
  api: DingtalkApiClient
  delivery: DingtalkDeliveryInfo
  /** AI 卡片模板 ID(缺省用官方公共模板) */
  cardTemplateId?: string
}

/**
 * 创建钉钉回复会话并立即发出占位卡片(秒回)。
 * 永不抛错:卡片全链路失败时降级为纯文本会话(sessionWebhook)。
 */
export async function createDingtalkReplySession(
  deps: DingtalkReplySessionDeps,
  placeholderText: string,
): Promise<ReplySession> {
  const { api, delivery } = deps
  try {
    const outTrackId = await api.createStreamCard(deps.cardTemplateId)
    await api.deliverCard(outTrackId, delivery)
    // 卡片创建成功但内容从占位开始: 直接切 INPUTING 并写入占位文本,
    // 用户立刻看到"正在思考…"的打字机卡片
    await api.putCardStatus(outTrackId, AI_CARD_STATUS.INPUTING, normalizeForCard(placeholderText))
    log('info', 'dingtalk', `streaming card created: ${outTrackId}`)
    return createCardSession(api, outTrackId, placeholderText)
  } catch (err) {
    log('warn', 'dingtalk', `streaming card unavailable, fallback to text: ${err}`)
    return createTextFallbackSession(api, delivery)
  }
}

/** AI 卡片会话: 节流 streaming 帧 + 串行保序 + 幂等收尾 */
function createCardSession(
  api: DingtalkApiClient,
  outTrackId: string,
  initialText: string,
): ReplySession {
  let finished = false
  let latestText = initialText
  let lastSent = initialText
  let timer: ReturnType<typeof setTimeout> | null = null
  // PUT 串行链: 同卡片帧必须有序(与飞书 sequence 语义对应的是 guid + 全量帧)
  let chain: Promise<void> = Promise.resolve()

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (finished || latestText === lastSent) return
    const text = latestText
    chain = chain
      .catch(() => {})
      .then(async () => {
        // 中间帧去尾换行,避免先渲染 <br> 再被下一帧修正的闪烁
        const ok = await api
          .putStreamingFrame({
            outTrackId,
            content: streamFrameContent(normalizeForCard(text), false),
            isFinalize: false,
          })
          .then(() => true)
          .catch((err) => {
            log('warn', 'dingtalk', `streaming frame failed: ${err}`)
            return false
          })
        if (ok) lastSent = text
      })
  }

  return {
    update(fullText: string): Promise<void> {
      if (finished) return Promise.resolve()
      latestText = fullText
      if (timer) return Promise.resolve() // 已有定时器,到点带最新文本
      timer = setTimeout(flush, STREAM_UPDATE_INTERVAL_MS)
      return Promise.resolve()
    },
    async finalize(finalText: string): Promise<void> {
      if (finished) return
      finished = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const text = normalizeForCard(finalText || '(完成)')
      chain = chain
        .catch(() => {})
        .then(async () => {
          // 终帧绕过节流: isFinalize=true 的全量帧 + FINISHED 状态(停掉打字机动画)
          await api.putStreamingFrame({
            outTrackId,
            content: streamFrameContent(text, true),
            isFinalize: true,
          })
          await api.putCardStatus(outTrackId, AI_CARD_STATUS.FINISHED, text)
        })
      await chain
      log('info', 'dingtalk', `streaming card finalized (${text.length} chars)`)
    },
    async fail(errorText: string): Promise<void> {
      if (finished) return
      finished = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const text = normalizeForCard(errorText)
      chain = chain
        .catch(() => {})
        .then(async () => {
          try {
            await api.putCardStatus(outTrackId, AI_CARD_STATUS.FAILED, text)
          } catch (err) {
            log('warn', 'dingtalk', `card fail-state update failed: ${err}`)
          }
        })
      await chain
    },
  }
}

/** 纯文本降级会话: 占位静默(不抢发),终稿/错误经 sessionWebhook 一次性发送 */
function createTextFallbackSession(
  api: DingtalkApiClient,
  delivery: DingtalkDeliveryInfo,
): ReplySession {
  let finished = false
  const send = (text: string): Promise<void> =>
    api
      .replyText(
        delivery.sessionWebhook,
        text,
        delivery.conversationType === '2' ? [delivery.senderStaffId] : [],
      )
      .catch((err: unknown) => {
        log('warn', 'dingtalk', `text fallback send failed: ${err}`)
      })
  return {
    update(): Promise<void> {
      /* 纯文本无法流式 */
      return Promise.resolve()
    },
    async finalize(finalText: string): Promise<void> {
      if (finished) return
      finished = true
      await send(finalText)
    },
    async fail(errorText: string): Promise<void> {
      if (finished) return
      finished = true
      await send(errorText)
    },
  }
}
