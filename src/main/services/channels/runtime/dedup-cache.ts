// =============================================================
// channels/runtime/dedup-cache — 已处理消息 id 去重缓存
// (M2 从 feishu-bot/dedup-cache.ts 上提,行为不变;原文件改为 re-export 壳)
// 平台至少一次投递(飞书 ack 超时/钉钉事件重推/邮件重投),重投的消息
// id 相同 — FIFO 淘汰,上限可配(飞书校准值 500)。
// =============================================================

const DEFAULT_DEDUP_CACHE_SIZE = 500

export class MessageDedupCache {
  private seenMessageIds: Set<string> = new Set()
  private seenMessageOrder: string[] = []
  private readonly capacity: number

  constructor(capacity: number = DEFAULT_DEDUP_CACHE_SIZE) {
    this.capacity = capacity > 0 ? capacity : DEFAULT_DEDUP_CACHE_SIZE
  }

  /** 该消息 id 是否已处理过 */
  has(id: string): boolean {
    return this.seenMessageIds.has(id)
  }

  /** 记录已处理的消息 id(FIFO 淘汰,上限 capacity) */
  remember(id: string): void {
    this.seenMessageIds.add(id)
    this.seenMessageOrder.push(id)
    if (this.seenMessageOrder.length > this.capacity) {
      const oldest = this.seenMessageOrder.shift()
      if (oldest) this.seenMessageIds.delete(oldest)
    }
  }
}
