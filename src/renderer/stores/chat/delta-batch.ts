// =============================================================
// 流式 delta 批处理 — 模块级缓冲状态 + 队列/flush 操作
// (PERF 优化: 高频 delta 合并到 50ms 一次 set,减少 re-render)
// 文本/思考两条批次共用 createDeltaBatcher 工厂,仅落点字段不同
// =============================================================

import type { ChatSet } from './types'

/** 单条批次: 50ms 缓冲 + 合并写入末条 assistant 消息 */
interface DeltaBatcher {
  queue: (delta: string, set: ChatSet) => void
  flush: (set: ChatSet) => void
}

/**
 * @param apply 返回要合并进末条 assistant 消息的字段增量
 *   (content 追加 / thinking 追加)
 */
function createDeltaBatcher(
  apply: (last: { content: string; thinking?: string }, combined: string) => object,
): DeltaBatcher {
  let batch: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flushInto = (set: ChatSet, combined: string) => {
    if (!combined) return
    set((s) => {
      const msgs = s.messages
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        // 只替换最后一条消息,避免复制整个数组
        return {
          messages: Object.assign([...msgs], {
            [msgs.length - 1]: { ...last, ...apply(last, combined) },
          }),
        }
      }
      return {}
    })
  }

  return {
    queue(delta, set) {
      batch.push(delta)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const combined = batch.join('')
        batch = []
        flushInto(set, combined)
      }, 50)
    },
    flush(set) {
      if (!timer) return
      clearTimeout(timer)
      timer = null
      const combined = batch.join('')
      batch = []
      flushInto(set, combined)
    },
  }
}

const contentBatcher = createDeltaBatcher((last, combined) => ({
  content: last.content + combined,
}))
const thinkingBatcher = createDeltaBatcher((last, combined) => ({
  thinking: (last.thinking ?? '') + combined,
}))

/** F1 修复: 模块级保存 store 的 set,供无参 flushStreamDeltas 使用 */
let boundSet: ChatSet | null = null

/** F1 修复: store 创建时绑定 set(store.ts 调用一次) */
export function bindStreamDeltaTarget(set: ChatSet): void {
  boundSet = set
}

/** F1 修复: 无参 flush,切换/清空会话前调用
 *  模块级 50ms 批处理缓冲无会话归属,若不 flush,
 *  pending delta 会在切换后写入新会话的末条 assistant 消息(跨会话泄漏) */
export function flushStreamDeltas(): void {
  if (boundSet) flushAllDeltas(boundSet)
}

/** 追加文本 delta(50ms 批处理) — 原 appendStreamDelta 实现 */
export function queueStreamDelta(delta: string, set: ChatSet): void {
  contentBatcher.queue(delta, set)
}

/** 追加思考过程 delta(50ms 批处理) — 原 appendThinkingDelta 实现 */
export function queueThinkingDelta(delta: string, set: ChatSet): void {
  thinkingBatcher.queue(delta, set)
}

/** 立即 flush 所有待处理的 delta 批处理 — flushStreamDeltas 的内部落点 */
function flushAllDeltas(set: ChatSet): void {
  contentBatcher.flush(set)
  thinkingBatcher.flush(set)
}
