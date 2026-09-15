// =============================================================
// adapters/feishu/event-handler — im.message.receive_v1 事件回调构造
// H3 不阻塞 ack + message_id 去重 + 排队深度限流(繁忙回复)。
// Sprint4c: ACL(_shared/acl) + InboundDebouncer + Typing reaction。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { log } from '../../../../utils/logger'
import type { ChatMessageQueue } from '../../runtime/chat-queue'
import type { MessageDedupCache } from '../../runtime/dedup-cache'
import { checkAcl, type AclPolicy } from '../_shared/acl'
import { InboundDebouncer, mergeTextMessages } from '../_shared/debounce'
import { parseIncomingMessage, SUPPORTED_MESSAGE_TYPES, type ParsedIncomingMessage } from './parsing'
import { addMessageReaction } from './reactions'
import { sendReply } from './reply'
import type { FeishuMessageEvent } from './types'

/** 事件回调所需依赖(由连接层注入,保持本模块无状态) */
export interface EventHandlerDeps {
  dedup: MessageDedupCache
  messageQueue: ChatMessageQueue
  getSdkClient: () => lark.Client | null
  /** 群聊响应开关(channels.feishu.allowGroups;缺省 true) */
  allowGroups?: boolean
  /** QwenPaw ACL(allowFrom / dm / group / requireMention) */
  acl?: AclPolicy
  /** 入站合并窗口 ms;0 关闭 */
  debounceMs?: number
  /** 可选外部 debouncer(连接层持有,便于 stop 时 clear) */
  debouncer?: InboundDebouncer<ParsedIncomingMessage>
  getAccessToken?: () => Promise<string | null>
  onAccepted?: (parsed: ParsedIncomingMessage) => void
}

function enqueue(deps: EventHandlerDeps, parsed: ParsedIncomingMessage): void {
  deps.onAccepted?.(parsed)
  if (!deps.messageQueue.submit({ parsed })) {
    log(
      'warn',
      'feishu-bot',
      `pending queue full (${deps.messageQueue.pendingCount}), drop message`,
    )
    void sendReply(deps.getSdkClient(), parsed.messageId, '当前消息处理繁忙,请稍后再发。').catch(
      () => {},
    )
  }
}

/**
 * 构造 im.message.receive_v1 事件回调。
 * 不在事件回调里 await — SDK 在 dispatcher.invoke 返回后才发 ack。
 */
export function createMessageReceiveHandler(
  deps: EventHandlerDeps,
): (data: FeishuMessageEvent) => void {
  const requireMention = deps.acl?.requireMention !== false
  return (data: FeishuMessageEvent): void => {
    const messageId = data.message?.message_id
    if (messageId && deps.dedup.has(messageId)) {
      log('info', 'feishu-bot', `duplicate message ${messageId}, skip`)
      return
    }
    if (messageId) deps.dedup.remember(messageId)

    const parsed = parseIncomingMessage(data, {
      allowGroups: deps.allowGroups !== false,
      requireMention,
    })
    if (!parsed) {
      const msgType = data.message?.message_type ?? 'unknown'
      if (!SUPPORTED_MESSAGE_TYPES.has(msgType)) {
        log('info', 'feishu-bot', `ignore unsupported message_type=${msgType}`)
      }
      return
    }

    if (deps.acl) {
      const chatType = parsed.chatType === 'p2p' ? 'p2p' : 'group'
      const decision = checkAcl(deps.acl, {
        chatType,
        senderId: parsed.senderId || parsed.chatId,
        chatId: parsed.chatId,
        mentioned: parsed.mentioned,
      })
      if (decision.decision !== 'allow') {
        log(
          'info',
          'feishu-bot',
          `acl ${decision.decision} (${decision.reason ?? ''}) sender=${parsed.senderId}`,
        )
        return
      }
    }

    // QwenPaw: 入站后加 Typing 表情(飞书无原生 typing API)
    addMessageReaction(deps.getSdkClient(), parsed.messageId, 'Typing', deps.getAccessToken)

    const debouncer = deps.debouncer
    const debounceMs = Math.max(0, Number(deps.debounceMs ?? 0) || 0)
    if (debouncer && debounceMs > 0) {
      debouncer.push(parsed)
      return
    }
    enqueue(deps, parsed)
  }
}

/** 连接层构造入站 debouncer(媒体旁路合并,对齐微信/QwenPaw) */
export function createFeishuInboundDebouncer(
  flushOne: (item: ParsedIncomingMessage) => void,
  windowMs: number,
): InboundDebouncer<ParsedIncomingMessage> {
  return new InboundDebouncer({
    keyOf: (item) => item.chatId || item.senderId || item.messageId,
    windowMs,
    onAppend: (existing, incoming) => {
      if ((incoming.attachments?.length ?? 0) > 0 || existing.some((e) => (e.attachments?.length ?? 0) > 0)) {
        return [...existing, incoming]
      }
      return mergeTextMessages(existing, incoming)
    },
    flush: (_key, items) => {
      for (const item of items) flushOne(item)
    },
  })
}
