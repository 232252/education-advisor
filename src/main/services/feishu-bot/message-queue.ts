// =============================================================
// feishu-bot/message-queue — 消息处理串行队列 + 排队深度限流(B6-4/H3)
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { log } from '../../utils/logger'
import { MAX_PENDING_MESSAGES } from './constants'

/**
 * B6-4 修复: 消息处理串行队列。
 * 飞书消息可能并发到达,但底层 agentService.runAgent 对同一 agent 有"已在运行"守卫
 * (会抛 "Agent is already running"),且共享的 getHistory 会让并发消息交叉拿到对方的回复。
 * 用 Promise 链把消息处理串行化,彻底消除竞态。
 *
 * H3: 排队中 + 处理中的消息总数,配合 MAX_PENDING_MESSAGES 限流。
 */
export class SerialMessageQueue {
  /** 队列尾指针(Promise 链) */
  private tail: Promise<void> = Promise.resolve()
  /** 排队中 + 处理中的消息总数 */
  private pending = 0

  /** 排队中 + 处理中的消息总数(诊断用) */
  get pendingCount(): number {
    return this.pending
  }

  /** 是否已达排队深度上限(超出由调用方回"繁忙"并丢弃,防止队列无限增长) */
  isFull(): boolean {
    return this.pending >= MAX_PENDING_MESSAGES
  }

  /**
   * 入队一条消息处理任务并立即返回(不 await 队列),让 SDK 立刻 ack。
   * H3 修复: 不在事件回调里 await 处理完成 — SDK 在 dispatcher.invoke 返回后才发 ack,
   * agent 运行可达数分钟,阻塞 ack 会致飞书服务器超时重投(消息被重复处理)。
   */
  enqueue(task: () => Promise<void>): void {
    this.pending++
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        try {
          await task()
        } catch (err) {
          log('error', 'feishu-bot', `message handler error: ${err}`)
        } finally {
          this.pending--
        }
      })
  }
}
