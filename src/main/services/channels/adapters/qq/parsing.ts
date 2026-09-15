// =============================================================
// adapters/qq/parsing — QQ 事件归一化(纯函数) + 附件提取
// =============================================================

import type { InboundAttachment } from '@shared/types'
import { QQ_MANIFEST_ID } from './constants'

export interface ParsedQqMessage {
  text: string
  messageId: string
  chatId: string
  chatType: string
  attachments: InboundAttachment[]
}

export interface QqDeliveryInfo {
  kind: 'c2c' | 'group'
  openid: string
  groupOpenid?: string
  msgId: string
}

export interface ParsedQqIncoming {
  parsed: ParsedQqMessage
  delivery: QqDeliveryInfo
}

function extractContent(d: Record<string, unknown>): string {
  const content = d.content
  return typeof content === 'string' ? content.trim() : ''
}

/** 从 attachments 字段提取图片/文件引用 */
export function extractQqAttachments(d: Record<string, unknown>): InboundAttachment[] {
  const raw = d.attachments
  if (!Array.isArray(raw)) return []
  const out: InboundAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const url = String(rec.url ?? rec.image_url ?? '')
    const contentType = String(rec.content_type ?? rec.contentType ?? '')
    const filename = String(rec.filename ?? rec.file_name ?? '') || undefined
    if (!url) continue
    const isImage =
      contentType.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename || url.split('?')[0] || '')
    out.push({
      kind: isImage ? 'image' : 'file',
      fileKey: url,
      fileName: filename,
    })
  }
  return out
}

/** 解析 WS dispatch 事件;非消息或过滤后返回 null */
export function parseQqDispatchEvent(
  eventType: string,
  data: unknown,
  opts: { allowGroups: boolean },
): ParsedQqIncoming | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const text = extractContent(d)
    .replace(/^<@!\d+>\s*/, '')
    .trim()
  const attachments = extractQqAttachments(d)
  if (!text && attachments.length === 0) return null

  if (eventType === 'C2C_MESSAGE_CREATE') {
    const author = (d.author as Record<string, unknown> | undefined) ?? {}
    const openid = String(author.user_openid ?? author.id ?? '')
    const msgId = String(d.id ?? '')
    if (!openid || !msgId) return null
    return {
      parsed: {
        text: text || (attachments.length ? `[收到 ${attachments.length} 个附件]` : ''),
        messageId: msgId,
        chatId: openid,
        chatType: 'p2p',
        attachments,
      },
      delivery: { kind: 'c2c', openid, msgId },
    }
  }

  if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
    if (!opts.allowGroups) return null
    const author = (d.author as Record<string, unknown> | undefined) ?? {}
    const openid = String(author.member_openid ?? author.id ?? '')
    const groupOpenid = String(d.group_openid ?? d.group_id ?? '')
    const msgId = String(d.id ?? '')
    if (!groupOpenid || !msgId) return null
    return {
      parsed: {
        text: text || (attachments.length ? `[收到 ${attachments.length} 个附件]` : ''),
        messageId: msgId,
        chatId: groupOpenid,
        chatType: 'group',
        attachments,
      },
      delivery: { kind: 'group', openid, groupOpenid, msgId },
    }
  }

  void QQ_MANIFEST_ID
  return null
}
