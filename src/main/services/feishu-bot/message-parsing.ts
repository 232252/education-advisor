// =============================================================
// feishu-bot/message-parsing — 入站消息解析与安全过滤
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { extractText } from '../feishu/message-utils'
import type { FeishuMessageEvent } from './types'

/** 解析后的入站消息(过滤规则已通过、文本已提取) */
export interface ParsedIncomingMessage {
  text: string
  messageId: string
  chatType: string
}

/**
 * 解析一条收到的飞书消息,不满足处理条件时返回 null。
 * 安全过滤:只响应 P2P 私聊,或群里 @了机器人的消息。
 */
export function parseIncomingMessage(data: FeishuMessageEvent): ParsedIncomingMessage | null {
  const msg = data.message
  if (!msg) return null

  // 只处理文本消息(其它类型如图片/文件暂不支持)
  if (msg.message_type !== 'text') return null

  // 安全过滤:群聊必须 @机器人;p2p 直接处理
  const chatType = msg.chat_type
  if (chatType !== 'p2p') {
    const mentions = msg.mentions ?? []
    if (mentions.length === 0) return null // 群里没 @机器人,忽略
  }

  // 解析消息文本(content 是 JSON 字符串: {"text":"@_user_1 你好"})
  // R6-7 修复:使用 feishu-message-utils.extractText 防止原型链污染
  const text = extractText(msg.content, msg.mentions ?? [])
  if (!text || text.trim().length === 0) return null

  return { text, messageId: msg.message_id, chatType }
}
