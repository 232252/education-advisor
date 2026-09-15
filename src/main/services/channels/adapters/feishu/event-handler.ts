// =============================================================
// adapters/feishu/event-handler — im.message.receive_v1 事件回调构造
// (M3 从 feishu-bot/event-handler.ts 搬入,不变;原文件改为 re-export 壳)
// H3 不阻塞 ack + message_id 去重 + 排队深度限流(繁忙回复)。
// 阶段 0:回调内完成解析(同步、廉价),把 ParsedIncomingMessage
// 提交 ChatMessageQueue;file/image 附件从此进入处理流程,
// 不再被静默丢弃(调研报告 §1.5)。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { log } from '../../../../utils/logger'
import type { ChatMessageQueue } from '../../runtime/chat-queue'
import type { MessageDedupCache } from '../../runtime/dedup-cache'
import { parseIncomingMessage, SUPPORTED_MESSAGE_TYPES } from './parsing'
import { sendReply } from './reply'
import type { FeishuMessageEvent } from './types'

/** 事件回调所需依赖(由连接层注入,保持本模块无状态) */
interface EventHandlerDeps {
  /** 已处理 message_id 去重缓存 */
  dedup: MessageDedupCache
  /** 按会话串行的消息批队列 */
  messageQueue: ChatMessageQueue
  /** 动态获取当前 SDK Client(用于"繁忙"回复) */
  getSdkClient: () => lark.Client | null
  /** M4: 群聊响应开关(channels.feishu.allowGroups;缺省 true) */
  allowGroups?: boolean
}

/**
 * 构造 im.message.receive_v1 事件回调。
 * H3 修复: 不在事件回调里 await 处理完成 — SDK 在 dispatcher.invoke 返回后才发 ack,
 * agent 运行可达数分钟,阻塞 ack 会致飞书服务器超时重推(消息被重复处理)。
 * 回调同步:去重 → 解析 → 入队 → 立即返回,让 SDK 立刻 ack。
 */
export function createMessageReceiveHandler(
  deps: EventHandlerDeps,
): (data: FeishuMessageEvent) => void {
  return (data: FeishuMessageEvent): void => {
    const messageId = data.message?.message_id
    // H3 修复: 去重 — 飞书至少一次投递,重投的 message_id 相同,直接跳过
    if (messageId && deps.dedup.has(messageId)) {
      log('info', 'feishu-bot', `duplicate message ${messageId}, skip`)
      return
    }
    if (messageId) deps.dedup.remember(messageId)

    // 解析(同步):text/post/file/image;群聊未 @机器人/空消息返回 null
    const parsed = parseIncomingMessage(data, { allowGroups: deps.allowGroups !== false })
    if (!parsed) {
      const msgType = data.message?.message_type ?? 'unknown'
      if (!SUPPORTED_MESSAGE_TYPES.has(msgType)) {
        log('info', 'feishu-bot', `ignore unsupported message_type=${msgType}`)
      }
      return
    }

    // H3 修复: 排队深度上限,防止突发消息撑爆内存/回复严重滞后
    if (!deps.messageQueue.submit({ parsed })) {
      log(
        'warn',
        'feishu-bot',
        `pending queue full (${deps.messageQueue.pendingCount}), drop message`,
      )
      if (messageId) {
        void sendReply(deps.getSdkClient(), messageId, '当前消息处理繁忙,请稍后再发。').catch(
          () => {},
        )
      }
      return
    }
    // 已入队(含秒回占位的触发),立即返回让 SDK ack
  }
}
