// =============================================================
// 流式 delta 批处理 — 模块级缓冲状态 + 队列/flush 操作
// (PERF 优化: 高频 delta 合并到 50ms 一次 set,减少 re-render)
// =============================================================

import type { ChatSet } from './types'

/** PERF 优化: 流式 delta 批处理,减少高频 set() 调用和数组复制
 *  每 50ms 批量 flush 一次到 Zustand,避免每个 delta 都触发 re-render 和数组复制 */
let deltaBatch: string[] = []
let deltaBatchTimer: ReturnType<typeof setTimeout> | null = null
let deltaBatchThinking: string[] = []
let deltaBatchThinkingTimer: ReturnType<typeof setTimeout> | null = null

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
  deltaBatch.push(delta)
  if (deltaBatchTimer) return
  deltaBatchTimer = setTimeout(() => {
    deltaBatchTimer = null
    const combined = deltaBatch.join('')
    deltaBatch = []
    if (!combined) return
    set((s) => {
      const msgs = s.messages
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        // 只替换最后一条消息,避免复制整个数组
        return {
          messages: Object.assign([...msgs], {
            [msgs.length - 1]: { ...last, content: last.content + combined },
          }),
        }
      }
      return {}
    })
  }, 50)
}

/** 追加思考过程 delta(50ms 批处理) — 原 appendThinkingDelta 实现 */
export function queueThinkingDelta(delta: string, set: ChatSet): void {
  deltaBatchThinking.push(delta)
  if (deltaBatchThinkingTimer) return
  deltaBatchThinkingTimer = setTimeout(() => {
    deltaBatchThinkingTimer = null
    const combined = deltaBatchThinking.join('')
    deltaBatchThinking = []
    if (!combined) return
    set((s) => {
      const msgs = s.messages
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        return {
          messages: Object.assign([...msgs], {
            [msgs.length - 1]: { ...last, thinking: (last.thinking ?? '') + combined },
          }),
        }
      }
      return {}
    })
  }, 50)
}

/** 立即 flush 所有待处理的 delta 批处理 (在 done/error/text_end 时调用) — 原 flushDeltas 实现 */
export function flushAllDeltas(set: ChatSet): void {
  if (deltaBatchTimer) {
    clearTimeout(deltaBatchTimer)
    deltaBatchTimer = null
    const combined = deltaBatch.join('')
    deltaBatch = []
    if (combined) {
      set((s) => {
        const msgs = s.messages
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          return {
            messages: Object.assign([...msgs], {
              [msgs.length - 1]: { ...last, content: last.content + combined },
            }),
          }
        }
        return {}
      })
    }
  }
  if (deltaBatchThinkingTimer) {
    clearTimeout(deltaBatchThinkingTimer)
    deltaBatchThinkingTimer = null
    const combined = deltaBatchThinking.join('')
    deltaBatchThinking = []
    if (combined) {
      set((s) => {
        const msgs = s.messages
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          return {
            messages: Object.assign([...msgs], {
              [msgs.length - 1]: { ...last, thinking: (last.thinking ?? '') + combined },
            }),
          }
        }
        return {}
      })
    }
  }
}
