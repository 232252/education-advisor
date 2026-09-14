// =============================================================
// adapters/weixin/parsing — iLink 入站消息归一化(纯函数)
// =============================================================

import type { InboundMessage } from '@shared/types'
import { WEIXIN_ITEM_TYPE_TEXT, WEIXIN_MANIFEST_ID, WEIXIN_MSG_TYPE_USER } from './constants'

export interface WeixinDeliveryInfo {
  toUserId: string
  contextToken: string
}

export interface ParsedWeixinMessage {
  inbound: InboundMessage
  delivery: WeixinDeliveryInfo
}

/** 从 item_list 提取纯文本 */
export function extractTextFromItems(itemList: unknown): string {
  if (!Array.isArray(itemList)) return ''
  const parts: string[] = []
  for (const item of itemList) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const type = Number(rec.type ?? 0)
    if (type === WEIXIN_ITEM_TYPE_TEXT) {
      const textItem = rec.text_item as Record<string, unknown> | undefined
      const t = textItem?.text
      if (typeof t === 'string' && t.trim()) parts.push(t.trim())
    }
  }
  return parts.join('\n')
}

/** 解析单条 iLink 消息;非用户文本返回 null */
export function parseWeixinMessage(raw: unknown, receivedAt = Date.now()): ParsedWeixinMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Record<string, unknown>
  const msgType = Number(msg.message_type ?? 0)
  if (msgType !== WEIXIN_MSG_TYPE_USER) return null

  const fromUserId = String(msg.from_user_id ?? '').trim()
  if (!fromUserId) return null
  const contextToken = String(msg.context_token ?? '')
  const text = extractTextFromItems(msg.item_list)
  if (!text) return null

  const providerMessageId =
    String(msg.context_token || msg.msg_id || msg.message_id || `${fromUserId}_${receivedAt}`)

  const inbound: InboundMessage = {
    channel: WEIXIN_MANIFEST_ID,
    providerMessageId,
    chat: { id: fromUserId, type: 'p2p' },
    sender: { id: fromUserId, name: fromUserId.split('@')[0] || fromUserId },
    text,
    attachments: [],
    raw,
    receivedAt,
  }
  return {
    inbound,
    delivery: { toUserId: fromUserId, contextToken },
  }
}

/** 从 getupdates 响应取出消息数组与下一游标 */
export function extractUpdatesPayload(data: Record<string, unknown>): {
  msgs: unknown[]
  cursor: string
} {
  const msgs = Array.isArray(data.msgs) ? data.msgs : []
  const next = data.get_updates_buf != null ? String(data.get_updates_buf) : ''
  return { msgs, cursor: next }
}
