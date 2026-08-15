// =============================================================
// feishu-bot/dedup-cache — 已处理 message_id 去重缓存(H3)
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { DEDUP_CACHE_SIZE } from './constants'

/**
 * H3: 已处理 message_id 去重缓存(飞书至少一次投递,ack 超时/网络抖动会重投,
 * 重投的 message_id 相同)。FIFO 淘汰,上限 DEDUP_CACHE_SIZE。
 */
export class MessageDedupCache {
  private seenMessageIds: Set<string> = new Set()
  private seenMessageOrder: string[] = []

  /** 该 message_id 是否已处理过 */
  has(id: string): boolean {
    return this.seenMessageIds.has(id)
  }

  /** 记录已处理的 message_id(FIFO,上限 DEDUP_CACHE_SIZE) */
  remember(id: string): void {
    this.seenMessageIds.add(id)
    this.seenMessageOrder.push(id)
    if (this.seenMessageOrder.length > DEDUP_CACHE_SIZE) {
      const oldest = this.seenMessageOrder.shift()
      if (oldest) this.seenMessageIds.delete(oldest)
    }
  }
}
