// =============================================================
// adapters/feishu/reply-session — 回复会话:秒回占位 + CardKit 流式更新 + 降级纯文本
// (M3 从 feishu-bot/streaming-card.ts 搬入,行为不变;原文件改为 re-export 壳)
// 调研报告 §2.1/§2.2:飞书无 typing indicator,业界标准做法是
// 收到消息立刻回复一张占位卡片("正在思考…"),随后原地流式更新。
//
// 优先走 CardKit v1(schema 2.0 streaming_mode);任一环节失败
// (应用缺 cardkit:card:write 权限 / 用户客户端 <7.20 / 接口异常)
// → 降级为"纯文本占位 + 最终纯文本回复"(即旧行为,不阻塞主流程)。
//
// finalize/fail 幂等(仅首次生效):stop() 抢先收尾后,批处理结束时的
// 再次调用为 no-op。
// ReplySession 接口契约在 @shared/types/channel(update 返回 Promise)。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import type { ReplySession } from '@shared/types'
import { log } from '../../../../utils/logger'
import { closeCardStream, createStreamingCard, sendCardReply, updateCardElement } from './api'
import { STREAM_UPDATE_INTERVAL_MS } from './constants'
import { sendReply } from './reply'

// ReplySession 接口已提升为共享契约(@shared/types/channel)。
export type { ReplySession }

/** 创建回复会话所需依赖 */
export interface ReplySessionDeps {
  getSdkClient: () => lark.Client | null
  /** 获取 tenant_access_token(流式卡片直连 API 用);拿不到返回 null → 降级 */
  getAccessToken: () => Promise<string | null>
}

/** 终稿摘要(会话列表预览,官方建议 ≤50 字) */
function summarize(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 50 ? `${flat.slice(0, 50)}…` : flat
}

/**
 * 创建回复会话并立即发出占位(秒回)。
 * 永不抛错:CardKit 全链路失败时降级为纯文本占位 + 最终纯文本。
 */
export async function createReplySession(
  deps: ReplySessionDeps,
  messageId: string,
  placeholderText: string,
): Promise<ReplySession> {
  const token = await deps.getAccessToken()
  if (token) {
    const cardId = await createStreamingCard(token, placeholderText, summarize(placeholderText))
    if (cardId && (await sendCardReply(deps.getSdkClient(), messageId, cardId))) {
      log('info', 'feishu-bot', `streaming card created: ${cardId}`)
      return createCardSession(token, cardId, placeholderText)
    }
  }
  // 降级:纯文本占位。占位本身发不出去也不抛(最终回复仍会尝试发送)
  log('info', 'feishu-bot', 'streaming card unavailable, fallback to text placeholder')
  await sendReply(deps.getSdkClient(), messageId, placeholderText)
  return createTextFallbackSession(deps, messageId)
}

/** CardKit 流式会话:节流更新 + sequence 严格递增 + PUT 串行保序 */
function createCardSession(token: string, cardId: string, initialText: string): ReplySession {
  let finished = false
  // 初始卡片内容视为 sequence 1,后续每次 PUT 递增(官方要求严格递增,错误 300317)
  let sequence = 1
  let latestText = initialText
  let lastSent = initialText
  let timer: ReturnType<typeof setTimeout> | null = null
  // PUT 串行链:保证 sequence 顺序与请求到达顺序一致(同卡片更新必须有序)
  let chain: Promise<void> = Promise.resolve()

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (finished || latestText === lastSent) return
    const text = latestText
    const seq = ++sequence
    chain = chain
      .catch(() => {})
      .then(async () => {
        const ok = await updateCardElement(token, cardId, text, seq)
        if (ok) lastSent = text
      })
  }

  return {
    update(fullText: string): Promise<void> {
      if (finished) return Promise.resolve()
      latestText = fullText
      if (timer) return Promise.resolve() // 已有定时器,到点会带最新文本
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
      const text = finalText || '(完成)'
      chain = chain
        .catch(() => {})
        .then(async () => {
          // 终稿绕过节流强制发送,保证完整内容落卡
          await updateCardElement(token, cardId, text, ++sequence)
          await closeCardStream(token, cardId, ++sequence, summarize(text))
        })
      await chain
      log('info', 'feishu-bot', `streaming card finalized (${text.length} chars)`)
    },
    async fail(errorText: string): Promise<void> {
      if (finished) return
      finished = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      chain = chain
        .catch(() => {})
        .then(async () => {
          await updateCardElement(token, cardId, errorText, ++sequence)
          await closeCardStream(token, cardId, ++sequence, summarize(errorText))
        })
      await chain
    },
  }
}

/** 纯文本降级会话:占位已另行发送,最终结果再发一条纯文本(即旧行为) */
function createTextFallbackSession(deps: ReplySessionDeps, messageId: string): ReplySession {
  let finished = false
  return {
    update(): Promise<void> {
      /* 纯文本无法流式 */
      return Promise.resolve()
    },
    async finalize(finalText: string): Promise<void> {
      if (finished) return
      finished = true
      await sendReply(deps.getSdkClient(), messageId, finalText)
    },
    async fail(errorText: string): Promise<void> {
      if (finished) return
      finished = true
      await sendReply(deps.getSdkClient(), messageId, errorText)
    },
  }
}
