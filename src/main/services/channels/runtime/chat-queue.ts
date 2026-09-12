// =============================================================
// channels/runtime/chat-queue — 按会话(chatId)串行的消息批队列
// (M2 从 feishu-bot/chat-queue.ts 上提,行为不变;原文件改为 re-export 壳)
// 语义(阶段 0 校准,调研报告 §2.4):
//   - 同一会话:合并窗口内连发的消息合成一批,批间串行 —
//     解决"连发两条不知道死活",并让"文件+说明文字"天然合并成一次处理
//   - 不同会话:并行,互不队头阻塞(全局串行会让所有用户互相排队)
//   - 斜杠命令:立即冲刷当前合并窗口并单独成批(不等待、无占位)
//   - 全局 pending 计数上限(maxPendingMessages),超出由调用方回"繁忙"并丢弃
//   - cancelAll():stop() 时对未开始的消息回调 onDrop 通知用户,不静默丢失
// 平台无关:入站消息形状为 ChannelQueueMessage(结构化类型,
// 飞书 ParsedIncomingMessage 等各渠道归一化结果天然满足)。
// =============================================================

import type { InboundAttachment, ReplySession } from '@shared/types'
import { log } from '../../../utils/logger'

/** 队列所需的最小入站消息形状(各渠道归一化结果的结构化基类) */
export interface ChannelQueueMessage {
  text: string
  messageId: string
  chatId: string
  chatType: string
  attachments: InboundAttachment[]
}

/** 一条已解析的入站消息 */
export interface QueueItem {
  parsed: ChannelQueueMessage
}

/** 一个待处理的批(合并窗口结束/命令直通后产生) */
export interface QueuedBatch {
  items: QueueItem[]
  /** 该批的占位回复会话(命令批为 null) */
  session: ReplySession | null
  /** 开始处理时前面还有几个批在排队(诊断用) */
  queuePosAtStart: number
}

export interface ChatQueueHooks {
  /**
   * 批次首条消息到达时立即调用 — 秒回占位("正在思考…"/"排队中第 N 位")。
   * 返回该批的回复会话(用于后续流式更新与终稿)。
   */
  onPlaceholder: (item: QueueItem, queuePos: number) => Promise<ReplySession | null>
  /** 一批开始处理(合并窗口结束 / 命令直通) */
  onBatch: (batch: QueuedBatch) => Promise<void>
  /** stop() 时未开始处理的消息通知用户(含该批已发出的占位会话,可为 null) */
  onDrop: (items: QueueItem[], session: ReplySession | null) => Promise<void>
}

/** 队列参数(默认值 = 阶段 0 飞书校准值) */
export interface ChatQueueOptions {
  /** 同会话合并窗口(ms) */
  mergeWindowMs?: number
  /** 全局待处理消息上限 */
  maxPendingMessages?: number
}

const DEFAULT_MERGE_WINDOW_MS = 2000
const DEFAULT_MAX_PENDING = 16

/** 单个会话的队列状态 */
interface ChatState {
  /** 批间串行链(Promise 链,同会话批严格按序执行) */
  chain: Promise<void>
  /** 合并窗口中累积的消息 */
  buffer: QueueItem[]
  bufferTimer: ReturnType<typeof setTimeout> | null
  /** 本批占位会话的创建 Promise(冲刷时等待,保证批拿到自己的会话) */
  placeholderPromise: Promise<ReplySession | null> | null
  /** 已入链未开始的批数(排队位置) */
  queuedBatches: number
  /** 正在冲刷(占位已发、批即将入链) — 排队位置计算含这一批 */
  flushing: boolean
}

/** 按会话串行的消息批队列 */
export class ChatMessageQueue {
  private chats = new Map<string, ChatState>()
  /** 全局待处理消息数(合并中 + 排队中 + 处理中),用于繁忙限流 */
  private pending = 0
  private stopped = false

  private readonly mergeWindowMs: number
  private readonly maxPendingMessages: number

  constructor(
    private readonly hooks: ChatQueueHooks,
    options: ChatQueueOptions = {},
  ) {
    this.mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS
    this.maxPendingMessages = options.maxPendingMessages ?? DEFAULT_MAX_PENDING
  }

  /** 全局待处理消息总数(诊断/状态展示) */
  get pendingCount(): number {
    return this.pending
  }

  /** 是否已达全局排队深度上限 */
  isFull(): boolean {
    return this.pending >= this.maxPendingMessages
  }

  /**
   * 提交一条已解析消息(同步返回,不阻塞事件 ack)。
   * @returns false = 已满,调用方应回"繁忙"并丢弃
   */
  submit(item: QueueItem): boolean {
    if (this.stopped) return true // 已停止(连接断开),静默接收避免误导性"繁忙"回复
    if (this.isFull()) return false
    this.pending++

    const st = this.ensureChat(item.parsed.chatId)

    // 斜杠命令:立即冲刷当前合并窗口成批,命令自身单独成批(无占位、不等待)
    if (item.parsed.text.trimStart().startsWith('/')) {
      void this.flushBuffer(st).then(() => {
        this.startBatch(st, [item], null)
      })
      return true
    }

    st.buffer.push(item)
    if (st.buffer.length === 1 && !st.placeholderPromise) {
      // 首条:立即秒回占位 + 开合并窗口
      const queuePos = st.queuedBatches + (st.flushing ? 1 : 0)
      st.placeholderPromise = this.hooks.onPlaceholder(item, queuePos).catch((err) => {
        log('warn', 'channel-queue', `placeholder failed: ${err}`)
        return null
      })
      st.bufferTimer = setTimeout(() => {
        void this.flushBuffer(st)
      }, this.mergeWindowMs)
    }
    return true
  }

  /**
   * 停止服务:未开始处理的消息(合并窗口中)通过 onDrop 通知用户,
   * 不再静默丢失。已入链未运行的批在轮到时也会走 onDrop(stopped 标志)。
   * 运行中的批由外部(service.stop)通过会话注册表收尾。
   */
  async cancelAll(): Promise<void> {
    this.stopped = true
    const dropped: Array<{ items: QueueItem[]; session: ReplySession | null }> = []
    for (const st of this.chats.values()) {
      if (st.bufferTimer) {
        clearTimeout(st.bufferTimer)
        st.bufferTimer = null
      }
      if (st.buffer.length === 0) continue
      const items = st.buffer
      st.buffer = []
      const session = await (st.placeholderPromise ?? Promise.resolve(null))
      st.placeholderPromise = null
      dropped.push({ items, session })
    }
    // 清空后 submit 仍可能被调用(stopped=true 静默),chats 置空防泄漏
    this.chats.clear()
    this.pending = 0
    for (const d of dropped) {
      try {
        await this.hooks.onDrop(d.items, d.session)
      } catch (err) {
        log('warn', 'channel-queue', `onDrop error: ${err}`)
      }
    }
  }

  /** 冲刷合并窗口:取出缓冲消息成批入链(等待占位会话就绪) */
  private async flushBuffer(st: ChatState): Promise<void> {
    if (st.bufferTimer) {
      clearTimeout(st.bufferTimer)
      st.bufferTimer = null
    }
    if (st.buffer.length === 0) return
    const items = st.buffer
    st.buffer = []
    const placeholder = st.placeholderPromise
    st.placeholderPromise = null
    // flushing 只标记"窗口已关、批即将入链(尚未计入 queuedBatches)"的间隙,
    // 供排队位置计算;批入链后立即复位,避免与 queuedBatches 双重计数
    st.flushing = true
    try {
      // 等占位会话创建完成(CardKit 创建约百毫秒级;内部已 catch 不会 reject)
      const session = (await placeholder) ?? null
      this.startBatch(st, items, session)
    } finally {
      st.flushing = false
    }
  }

  /** 把一批挂到会话串行链上 */
  private startBatch(st: ChatState, items: QueueItem[], session: ReplySession | null): void {
    st.queuedBatches++
    const queuePosAtStart = st.queuedBatches - 1
    st.chain = st.chain
      .catch(() => {})
      .then(async () => {
        try {
          if (this.stopped) {
            // 排队期间服务被停止:通知用户而非静默吞掉
            await this.hooks.onDrop(items, session)
            return
          }
          await this.hooks.onBatch({ items, session, queuePosAtStart })
        } catch (err) {
          log('error', 'channel-queue', `batch handler error: ${err}`)
        } finally {
          st.queuedBatches--
          this.pending -= items.length
          if (this.pending < 0) this.pending = 0
          this.cleanupChat(st)
        }
      })
  }

  private ensureChat(chatId: string): ChatState {
    let st = this.chats.get(chatId)
    if (!st) {
      st = {
        chain: Promise.resolve(),
        buffer: [],
        bufferTimer: null,
        placeholderPromise: null,
        queuedBatches: 0,
        flushing: false,
      }
      this.chats.set(chatId, st)
    }
    return st
  }

  /** 会话无任何活动时从 map 移除,防长期运行内存增长 */
  private cleanupChat(st: ChatState): void {
    if (st.queuedBatches === 0 && st.buffer.length === 0 && !st.placeholderPromise) {
      for (const [chatId, candidate] of this.chats) {
        if (candidate === st) {
          this.chats.delete(chatId)
          break
        }
      }
    }
  }
}
