// =============================================================
// adapters/weixin/parsing — iLink 入站消息归一化(纯函数)
// 支持 text / image / voice(ASR) / file / video 附件引用
// =============================================================

import type { InboundAttachment, InboundMessage } from '@shared/types'
import {
  WEIXIN_ITEM_TYPE_FILE,
  WEIXIN_ITEM_TYPE_IMAGE,
  WEIXIN_ITEM_TYPE_TEXT,
  WEIXIN_ITEM_TYPE_VIDEO,
  WEIXIN_ITEM_TYPE_VOICE,
  WEIXIN_MANIFEST_ID,
  WEIXIN_MSG_TYPE_USER,
} from './constants'

export interface WeixinDeliveryInfo {
  toUserId: string
  contextToken: string
}

/** 附件下载所需的 CDN/AES 元数据(序列化进 fileKey) */
export interface WeixinMediaMeta {
  kind: 'image' | 'file'
  encryptQueryParam: string
  aesKey: string
  fileName: string
}

export interface ParsedWeixinMessage {
  inbound: InboundMessage
  delivery: WeixinDeliveryInfo
}

export function encodeWeixinMediaKey(meta: WeixinMediaMeta): string {
  return `wxmedia:${Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url')}`
}

export function decodeWeixinMediaKey(fileKey: string): WeixinMediaMeta | null {
  if (!fileKey.startsWith('wxmedia:')) return null
  try {
    const json = Buffer.from(fileKey.slice('wxmedia:'.length), 'base64url').toString('utf8')
    const obj = JSON.parse(json) as WeixinMediaMeta
    if (!obj.encryptQueryParam) return null
    return obj
  } catch {
    return null
  }
}

/** 从 item_list 提取纯文本(+ voice ASR) */
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
    } else if (type === WEIXIN_ITEM_TYPE_VOICE) {
      const voiceItem = (rec.voice_item as Record<string, unknown> | undefined) ?? {}
      const textItem = voiceItem.text_item as Record<string, unknown> | undefined
      const asr =
        (typeof textItem?.text === 'string' && textItem.text.trim()) ||
        (typeof voiceItem.text === 'string' && voiceItem.text.trim()) ||
        ''
      if (asr) parts.push(asr)
      else parts.push('[语音消息]')
    }
  }
  return parts.join('\n')
}

/** 从 item_list 提取可下载附件引用 */
export function extractAttachmentsFromItems(itemList: unknown): InboundAttachment[] {
  if (!Array.isArray(itemList)) return []
  const out: InboundAttachment[] = []
  for (const item of itemList) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const type = Number(rec.type ?? 0)
    if (type === WEIXIN_ITEM_TYPE_IMAGE) {
      const img = (rec.image_item as Record<string, unknown> | undefined) ?? {}
      const media = (img.media as Record<string, unknown> | undefined) ?? {}
      const enc = String(media.encrypt_query_param ?? '')
      const aeskeyHex = String(img.aeskey ?? '')
      const aesKey = aeskeyHex
        ? Buffer.from(aeskeyHex, 'hex').toString('base64')
        : String(media.aes_key ?? '')
      if (!enc) continue
      out.push({
        kind: 'image',
        fileKey: encodeWeixinMediaKey({
          kind: 'image',
          encryptQueryParam: enc,
          aesKey,
          fileName: 'image.jpg',
        }),
        fileName: 'image.jpg',
      })
    } else if (type === WEIXIN_ITEM_TYPE_FILE || type === WEIXIN_ITEM_TYPE_VIDEO) {
      const fileItem =
        type === WEIXIN_ITEM_TYPE_VIDEO
          ? ((rec.video_item as Record<string, unknown> | undefined) ?? {})
          : ((rec.file_item as Record<string, unknown> | undefined) ?? {})
      const media = (fileItem.media as Record<string, unknown> | undefined) ?? {}
      const enc = String(media.encrypt_query_param ?? '')
      const aesKey = String(media.aes_key ?? '')
      const fileName =
        type === WEIXIN_ITEM_TYPE_VIDEO
          ? 'video.mp4'
          : String(fileItem.file_name ?? 'file.bin') || 'file.bin'
      if (!enc) continue
      out.push({
        kind: 'file',
        fileKey: encodeWeixinMediaKey({
          kind: 'file',
          encryptQueryParam: enc,
          aesKey,
          fileName,
        }),
        fileName,
      })
    }
  }
  return out
}

/** 解析单条 iLink 消息;非用户消息或空内容返回 null */
export function parseWeixinMessage(raw: unknown, receivedAt = Date.now()): ParsedWeixinMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Record<string, unknown>
  const msgType = Number(msg.message_type ?? 0)
  if (msgType !== WEIXIN_MSG_TYPE_USER) return null

  const fromUserId = String(msg.from_user_id ?? '').trim()
  if (!fromUserId) return null
  const contextToken = String(msg.context_token ?? '')
  const text = extractTextFromItems(msg.item_list)
  const attachments = extractAttachmentsFromItems(msg.item_list)
  if (!text && attachments.length === 0) return null

  const providerMessageId = String(
    msg.msg_id || msg.message_id || msg.context_token || `${fromUserId}_${receivedAt}`,
  )

  const inbound: InboundMessage = {
    channel: WEIXIN_MANIFEST_ID,
    providerMessageId,
    chat: { id: fromUserId, type: 'p2p' },
    sender: { id: fromUserId, name: fromUserId.split('@')[0] || fromUserId },
    text: text || (attachments.length ? `[收到 ${attachments.length} 个附件]` : ''),
    attachments,
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
  ret: number
} {
  const msgs = Array.isArray(data.msgs) ? data.msgs : []
  const next = data.get_updates_buf != null ? String(data.get_updates_buf) : ''
  const ret = data.ret != null ? Number(data.ret) : 0
  return { msgs, cursor: next, ret }
}
