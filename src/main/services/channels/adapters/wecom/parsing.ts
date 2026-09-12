// =============================================================
// adapters/wecom/parsing — aibot_msg_callback body → 队列消息 + 投递信息
// 消息体字段(官方 SDK types/message.d.ts 逐字段核对):
//   msgid(排重键) / chattype 'single'|'group' / chatid(仅群聊) /
//   from.userid / text.content / voice.content(ASR) /
//   image|file|video {url, aeskey} / mixed.msg_item[]
// 附件的 url 5 分钟内有效 → 引擎立即下载并 AES 解密(不在 fileKey 里
// 存 aeskey,投递信息持有完整附件上下文)。
// =============================================================

import type { InboundAttachment } from '@shared/types'

export interface ParsedWecomMessage {
  text: string
  messageId: string
  chatId: string
  chatType: string
  attachments: InboundAttachment[]
}

/** 附件完整上下文(下载+解密需要 url 与 aeskey;引擎 LRU 持有) */
export interface WecomAttachmentContext {
  url: string
  aesKey: string
  kind: 'file' | 'image'
  fileName: string
}

export interface WecomDeliveryInfo {
  /** 回调帧 req_id(回复必须透传同值) */
  reqId: string
  chatType: 'single' | 'group'
  /** 单聊 = from.userid;群聊 = chatid */
  chatId: string
  userId: string
  /** 本条消息携带的附件上下文(按 fileKey= url 对应) */
  attachments: WecomAttachmentContext[]
}

export interface ParsedWecomIncoming {
  parsed: ParsedWecomMessage
  delivery: WecomDeliveryInfo
}

export const SUPPORTED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'image',
  'mixed',
  'voice',
  'file',
  'video',
])

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 从 image/file/video 结构提取附件 */
function mediaAttachment(
  content: unknown,
  kind: 'file' | 'image',
  fallbackName: string,
): WecomAttachmentContext | null {
  if (!content || typeof content !== 'object') return null
  const c = content as { url?: unknown; aeskey?: unknown }
  const url = str(c.url)
  if (!url) return null
  return { url, aesKey: str(c.aeskey), kind, fileName: fallbackName }
}

/**
 * 解析消息回调 body。
 * @param body     回调帧 body
 * @param reqId    回调帧 headers.req_id(回复透传)
 * @param allowGroups false 时群聊消息返回 null
 */
export function parseWecomMessage(
  body: unknown,
  reqId: string,
  opts: { allowGroups?: boolean } = {},
): ParsedWecomIncoming | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  const msgId = str(b.msgid)
  const chatType = str(b.chattype) === 'group' ? 'group' : 'single'
  if (chatType === 'group' && opts.allowGroups === false) return null

  const userId = str((b.from as { userid?: unknown } | undefined)?.userid)
  const groupChatId = str(b.chatid)
  // 会话键: 群聊用 chatid(同群合并窗口),单聊用 userid(同人持续对话)
  const chatId = chatType === 'group' ? groupChatId : userId
  if (!msgId || !chatId || !userId || !reqId) return null

  const attachments: WecomAttachmentContext[] = []
  const base = {
    messageId: msgId,
    chatId,
    chatType: chatType === 'group' ? 'group' : 'p2p',
  }
  const msgtype = str(b.msgtype)

  switch (msgtype) {
    case 'text': {
      const text = str((b.text as { content?: unknown } | undefined)?.content).trim()
      if (!text) return null
      return {
        parsed: { ...base, text, attachments: [] },
        delivery: { reqId, chatType, chatId, userId, attachments: [] },
      }
    }
    case 'voice': {
      const text = str((b.voice as { content?: unknown } | undefined)?.content) || '[语音消息]'
      return {
        parsed: { ...base, text, attachments: [] },
        delivery: { reqId, chatType, chatId, userId, attachments: [] },
      }
    }
    case 'image': {
      const att = mediaAttachment(b.image, 'image', 'image.png')
      if (!att) return null
      attachments.push(att)
      return {
        parsed: { ...base, text: '[图片]', attachments: [{ kind: 'image', fileKey: att.url }] },
        delivery: { reqId, chatType, chatId, userId, attachments },
      }
    }
    case 'file': {
      const att = mediaAttachment(b.file, 'file', 'file')
      if (!att) return null
      attachments.push(att)
      return {
        parsed: { ...base, text: '[文件]', attachments: [{ kind: 'file', fileKey: att.url }] },
        delivery: { reqId, chatType, chatId, userId, attachments },
      }
    }
    case 'video': {
      const att = mediaAttachment(b.video, 'file', 'video.mp4')
      if (!att) return null
      attachments.push(att)
      return {
        parsed: { ...base, text: '[视频]', attachments: [{ kind: 'file', fileKey: att.url }] },
        delivery: { reqId, chatType, chatId, userId, attachments },
      }
    }
    case 'mixed': {
      const items = (b.mixed as { msg_item?: unknown[] } | undefined)?.msg_item
      const texts: string[] = []
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          const it = item as {
            msgtype?: unknown
            text?: { content?: unknown }
            image?: unknown
          }
          if (str(it.msgtype) === 'text' && str(it.text?.content)) texts.push(str(it.text?.content))
          if (str(it.msgtype) === 'image') {
            const att = mediaAttachment(it.image, 'image', 'image.png')
            if (att) attachments.push(att)
          }
        }
      }
      const text = texts.join('') || (attachments.length > 0 ? '[图文消息]' : '')
      if (!text && attachments.length === 0) return null
      return {
        parsed: {
          ...base,
          text,
          attachments: attachments.map((a) => ({ kind: a.kind, fileKey: a.url })),
        },
        delivery: { reqId, chatType, chatId, userId, attachments },
      }
    }
    default:
      return null
  }
}
