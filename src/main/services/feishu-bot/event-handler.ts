// =============================================================
// feishu-bot/event-handler — im.message.receive_v1 事件回调构造
// 从 feishu-bot-service.ts start() 内联事件回调下沉(纯重构,行为不变):
// H3 不阻塞 ack + message_id 去重 + 排队深度限流(繁忙回复)。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { log } from '../../utils/logger'
import type { MessageDedupCache } from './dedup-cache'
import type { SerialMessageQueue } from './message-queue'
import { sendReply } from './reply'
import type { FeishuMessageEvent } from './types'

/** 事件回调所需依赖(由 facade 注入,保持本模块无状态) */
export interface EventHandlerDeps {
  /** 已处理 message_id 去重缓存 */
  dedup: MessageDedupCache
  /** 消息处理串行队列(含排队深度限流) */
  messageQueue: SerialMessageQueue
  /** 动态获取当前 SDK Client(用于"繁忙"回复) */
  getSdkClient: () => lark.Client | null
  /** 实际消息处理流程(入队串行执行) */
  handleMessage: (data: FeishuMessageEvent) => Promise<void>
}

/**
 * 构造 im.message.receive_v1 事件回调。
 * H3 修复: 不在事件回调里 await 处理完成 — SDK 在 dispatcher.invoke 返回后才发 ack,
 * agent 运行可达数分钟,阻塞 ack 会致飞书服务器超时重投(消息被重复处理)。
 * 回调同步入队后立即返回,让 SDK 立刻 ack。
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

    // H3 修复: 排队深度上限,防止突发消息撑爆内存/回复严重滞后
    if (deps.messageQueue.isFull()) {
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
    deps.messageQueue.enqueue(() => deps.handleMessage(data))
    // 立即返回(不 await 队列),让 SDK 立刻 ack
  }
}
