// =============================================================
// adapters/dingtalk/parsing — 机器人回调 data → 队列消息 + 投递信息
// 回调字段事实(官方连接器 + 开放平台文档):
//   conversationType: '1' 单聊 / '2' 群聊(群聊仅在 @机器人 时推送)
//   sessionWebhook: 本条消息的回复 webhook(文本回复最短路径)
//   content: {downloadCode, fileName, recognition, richText}(字符串或对象,两态兼容)
// 解析输出 = ChannelQueueMessage 最小形状 + DingtalkDeliveryInfo
// (回复卡片/文本所需的会话定位信息,由引擎按 msgId 存 LRU)。
// =============================================================

import type { InboundAttachment } from '@shared/types'

/** 解析后的入站消息(runtime/chat-queue 的最小形状) */
export interface ParsedDingtalkMessage {
  text: string
  messageId: string
  chatId: string
  chatType: string
  attachments: InboundAttachment[]
}

/**
 * 回复投递信息(每条消息携带;回复文本/卡片需要):
 *   - sessionWebhook 一次性文本回复(命令回执/降级链)
 *   - conversationType/conversationId/senderStaffId 定位 AI 卡片投放目标
 */
export interface DingtalkDeliveryInfo {
  sessionWebhook: string
  conversationType: '1' | '2'
  /** 单聊 = senderStaffId;群聊 = conversationId(openConversationId) */
  conversationId: string
  senderStaffId: string
  senderNick?: string
}

/** 解析结果:队列消息 + 投递信息(unsupported/被过滤时为 null) */
export interface ParsedDingtalkIncoming {
  parsed: ParsedDingtalkMessage
  delivery: DingtalkDeliveryInfo
}

/** 本模块支持的 msgtype(其余类型 event-handler 忽略并记日志) */
export const SUPPORTED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'richText',
  'picture',
  'audio',
  'video',
  'file',
])

interface BotCallbackData {
  msgtype?: unknown
  msgId?: unknown
  conversationType?: unknown
  conversationId?: unknown
  senderStaffId?: unknown
  senderId?: unknown
  senderNick?: unknown
  sessionWebhook?: unknown
  text?: unknown
  content?: unknown
  richText?: unknown
}

/** content 兼容两态: 新结构为对象,旧结构为 JSON 字符串 */
function resolveContent(data: BotCallbackData): Record<string, unknown> {
  const raw = data.content
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* 旧结构解析失败按空处理 */
    }
  }
  return {}
}

/** richText 列表兼容两态: 新结构 content.richText / 旧结构 richText.richTextList */
function resolveRichList(data: BotCallbackData, content: Record<string, unknown>): unknown[] {
  const nested = content.richText
  if (Array.isArray(nested)) return nested
  const legacy = data.richText as { richTextList?: unknown } | undefined
  if (legacy && typeof legacy === 'object' && Array.isArray(legacy.richTextList)) {
    return legacy.richTextList
  }
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 解析机器人回调 data。
 * @param data      回调 JSON.parse 后的对象
 * @param allowGroups false 时群聊消息返回 null(只响应私聊)
 */
export function parseDingtalkMessage(
  data: unknown,
  opts: { allowGroups?: boolean } = {},
): ParsedDingtalkIncoming | null {
  if (!data || typeof data !== 'object') return null
  const d = data as BotCallbackData

  const msgId = str(d.msgId)
  const conversationType = str(d.conversationType) === '2' ? '2' : '1'
  if (conversationType === '2' && opts.allowGroups === false) return null

  const senderStaffId = str(d.senderStaffId) || str(d.senderId)
  const sessionWebhook = str(d.sessionWebhook)
  // 单聊会话键用发送者 userId(同一个人持续对话);
  // 群聊用 conversationId(同群合并窗口)。
  const chatId = conversationType === '2' ? str(d.conversationId) : senderStaffId
  if (!msgId || !chatId || !senderStaffId || !sessionWebhook) return null

  const delivery: DingtalkDeliveryInfo = {
    sessionWebhook,
    conversationType,
    conversationId: str(d.conversationId),
    senderStaffId,
    senderNick: str(d.senderNick) || undefined,
  }

  const base = { messageId: msgId, chatId, chatType: conversationType === '2' ? 'group' : 'p2p' }
  const msgtype = str(d.msgtype) || 'text'
  const content = resolveContent(d)

  switch (msgtype) {
    case 'text': {
      const textObj = d.text as { content?: unknown } | undefined
      const text = str(textObj?.content).trim()
      // 纯 @ 机器人(无文字)在群聊中会出现空文本 → 忽略
      if (!text) return null
      return { parsed: { ...base, text, attachments: [] }, delivery }
    }
    case 'picture': {
      const downloadCode = str(content.downloadCode)
      if (!downloadCode) return null
      return {
        parsed: {
          ...base,
          text: '[图片]',
          attachments: [{ kind: 'image', fileKey: downloadCode, fileName: 'image.png' }],
        },
        delivery,
      }
    }
    case 'audio': {
      // 语音: content.recognition 为钉钉 ASR 文本;无则提示无法转写
      const downloadCode = str(content.downloadCode)
      const recognition = str(content.recognition)
      const text = recognition || '[语音消息]'
      const attachments = downloadCode
        ? [{ kind: 'file' as const, fileKey: downloadCode, fileName: str(content.fileName) || 'voice.amr' }]
        : []
      return { parsed: { ...base, text, attachments }, delivery }
    }
    case 'video': {
      const downloadCode = str(content.downloadCode)
      if (!downloadCode) return null
      return {
        parsed: {
          ...base,
          text: '[视频]',
          attachments: [
            { kind: 'file', fileKey: downloadCode, fileName: str(content.fileName) || 'video.mp4' },
          ],
        },
        delivery,
      }
    }
    case 'file': {
      const downloadCode = str(content.downloadCode)
      if (!downloadCode) return null
      return {
        parsed: {
          ...base,
          text: '[文件]',
          attachments: [
            { kind: 'file', fileKey: downloadCode, fileName: str(content.fileName) || 'file' },
          ],
        },
        delivery,
      }
    }
    case 'richText': {
      const richList = resolveRichList(d, content)
      const textParts: string[] = []
      const attachments: InboundAttachment[] = []
      for (const item of richList) {
        if (!item || typeof item !== 'object') continue
        const it = item as { text?: unknown; downloadCode?: unknown; fileName?: unknown }
        // 文字段与附件引用不互斥(同一 item 可同时带文本与 downloadCode)
        if (str(it.text)) textParts.push(str(it.text))
        const code = str(it.downloadCode)
        if (code) {
          attachments.push({ kind: 'file', fileKey: code, fileName: str(it.fileName) || 'file' })
        }
      }
      const text = textParts.join('') || (attachments.length > 0 ? '[富文本消息]' : '')
      if (!text && attachments.length === 0) return null
      return { parsed: { ...base, text, attachments }, delivery }
    }
    default:
      return null
  }
}
