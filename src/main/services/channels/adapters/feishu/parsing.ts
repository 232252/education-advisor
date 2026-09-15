// =============================================================
// adapters/feishu/parsing — 入站消息解析与安全过滤
// (M3 从 feishu-bot/message-parsing.ts 搬入,不变;原文件改为 re-export 壳)
// 阶段 0(调研报告 §1.5):不再只收 text — file/image 转为附件下载,
// post 富文本提取其中文字。此前 file/image 被静默丢弃(实测事故:
// 用户发的 Excel 机器人"看不到",Agent 转而去桌面乱找文件)。
// 输出 ParsedIncomingMessage 即 ChannelQueueMessage 的飞书实例
// (结构化满足 runtime/chat-queue 的最小形状)。
// =============================================================

import { extractText } from '../../../feishu/message-utils'
import type { FeishuMessageEvent } from './types'

/** 接收到的附件(file 消息或 image 消息) */
export interface IncomingAttachment {
  kind: 'file' | 'image'
  /** file 消息为 file_key;image 消息为 image_key(下载接口同一套,type 不同) */
  fileKey: string
  /** 原始文件名(image 消息无) */
  fileName?: string
}

/** 解析后的入站消息(过滤规则已通过、文本已提取) */
export interface ParsedIncomingMessage {
  text: string
  messageId: string
  chatId: string
  chatType: string
  /** 发送者 open_id(优先) / user_id,供 ACL */
  senderId: string
  /** 群聊是否 @了机器人(mentions 非空) */
  mentioned: boolean
  attachments: IncomingAttachment[]
}

/** 本模块支持处理的消息类型(其余类型 event-handler 直接忽略并记日志) */
export const SUPPORTED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'post',
  'file',
  'image',
])

/** 安全解析 content JSON 字符串(失败返回 null,不抛错) */
function safeParseContent(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/** 提取 post 富文本消息里的文字段(content 为嵌套 JSON 字符串) */
function extractPostText(content: string): string {
  const parsed = safeParseContent(content)
  if (!parsed) return ''
  const lines: string[] = []
  const title = parsed.title
  if (typeof title === 'string' && title.trim()) lines.push(title.trim())
  const body = parsed.content
  if (Array.isArray(body)) {
    for (const paragraph of body) {
      if (!Array.isArray(paragraph)) continue
      const segTexts: string[] = []
      for (const seg of paragraph) {
        if (
          seg &&
          typeof seg === 'object' &&
          (seg as { tag?: unknown }).tag !== 'img' &&
          typeof (seg as { text?: unknown }).text === 'string'
        ) {
          segTexts.push((seg as { text: string }).text)
        }
      }
      const line = segTexts.join('').trim()
      if (line) lines.push(line)
    }
  }
  return lines.join('\n')
}

/**
 * 解析一条收到的飞书消息,不满足处理条件时返回 null。
 * 安全过滤:私聊直通;群聊默认需 @机器人(requireMention)。
 * @param opts.allowGroups false 时忽略全部群聊消息(channels.feishu.allowGroups)
 * @param opts.requireMention false 时群聊不强制 @ (QwenPaw require_mention/group_at_only)
 */
export function parseIncomingMessage(
  data: FeishuMessageEvent,
  opts: { allowGroups?: boolean; requireMention?: boolean } = {},
): ParsedIncomingMessage | null {
  const msg = data.message
  if (!msg) return null

  if (!SUPPORTED_MESSAGE_TYPES.has(msg.message_type)) return null

  const chatType = msg.chat_type
  const mentions = msg.mentions ?? []
  const mentioned = chatType === 'p2p' ? true : mentions.length > 0
  // allowGroups=false 时忽略全部群聊(ACL group:deny 由上层再挡一层)
  if (chatType !== 'p2p' && opts.allowGroups === false) return null
  // 默认仍要求群 @(opts.requireMention !== false);关闭后交给 ACL 细控
  if (chatType !== 'p2p' && opts.requireMention !== false && !mentioned) return null

  const senderId =
    data.sender?.sender_id?.open_id ||
    data.sender?.sender_id?.user_id ||
    data.sender?.sender_id?.union_id ||
    ''

  let text = ''
  const attachments: IncomingAttachment[] = []

  if (msg.message_type === 'text') {
    // 解析消息文本(content 是 JSON 字符串: {"text":"@_user_1 你好"})
    // R6-7 修复:使用 feishu-message-utils.extractText 防止原型链污染
    text = extractText(msg.content, msg.mentions ?? [])
  } else if (msg.message_type === 'post') {
    text = extractPostText(msg.content)
  } else if (msg.message_type === 'file') {
    const parsed = safeParseContent(msg.content)
    const fileKey = parsed?.file_key
    if (typeof fileKey === 'string' && fileKey) {
      attachments.push({
        kind: 'file',
        fileKey,
        fileName: typeof parsed?.file_name === 'string' ? parsed.file_name : undefined,
      })
    }
  } else if (msg.message_type === 'image') {
    const parsed = safeParseContent(msg.content)
    const imageKey = parsed?.image_key
    if (typeof imageKey === 'string' && imageKey) {
      attachments.push({ kind: 'image', fileKey: imageKey })
    }
  }

  // 既无文字也无附件(如空 post / 内容解析失败) → 不处理
  if (!text.trim() && attachments.length === 0) return null

  return {
    text,
    messageId: msg.message_id,
    chatId: msg.chat_id,
    chatType,
    senderId,
    mentioned,
    attachments,
  }
}
