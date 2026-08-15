// =============================================================
// Agent 实时输出批处理 — 模块级缓冲状态 + flush/append 操作
// (PERF: 把高频 output 合并到 50ms 一次 set,防内存无界增长)
// =============================================================

import type { AgentState } from './types'

/**
 * PERF: 流式 delta 批处理 — 把高频 text_delta 合并到 50ms 一次 set(),
 * 避免每个 delta 触发一次 Zustand 状态更新和组件重渲染。
 * 仿 chatStore 的 deltaBatch 机制。
 */
let _liveOutputBatch: string[] = []
let _liveOutputTimer: ReturnType<typeof setTimeout> | null = null
const LIVE_OUTPUT_BATCH_MS = 50
// R95 修复: 限制 liveOutput 最大字符数 (1MB),防止长 agent 运行导致内存无界增长
const LIVE_OUTPUT_MAX_CHARS = 1_000_000

export function _flushLiveOutput(set: (fn: (s: AgentState) => Partial<AgentState>) => void): void {
  if (_liveOutputTimer) {
    clearTimeout(_liveOutputTimer)
    _liveOutputTimer = null
  }
  if (_liveOutputBatch.length === 0) return
  const combined = _liveOutputBatch.join('')
  _liveOutputBatch = []
  if (!combined) return
  set((s) => {
    const next = s.liveOutput + combined
    // 超过上限时保留尾部 (最新输出),截断头部
    if (next.length > LIVE_OUTPUT_MAX_CHARS) {
      return {
        liveOutput: `\n…[输出已截断,仅保留最近 ${LIVE_OUTPUT_MAX_CHARS} 字符]\n${next.slice(-LIVE_OUTPUT_MAX_CHARS)}`,
      }
    }
    return { liveOutput: next }
  })
}

/** 立即刷新批处理 — 用于状态切换(running→idle/error)前确保输出完整 */
export function _flushLiveOutputNow(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
): void {
  _flushLiveOutput(set)
}

export function _appendLiveOutput(
  delta: string,
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
): void {
  if (!delta) return
  _liveOutputBatch.push(delta)
  if (_liveOutputTimer) return
  _liveOutputTimer = setTimeout(() => {
    _liveOutputTimer = null
    _flushLiveOutput(set)
  }, LIVE_OUTPUT_BATCH_MS)
}

/** 清空批处理缓冲(含遗留 timer) — 原代码中 `_liveOutputBatch = []` 与 clearOutput 开头的清理 */
export function resetLiveOutputBuffer(): void {
  if (_liveOutputTimer) {
    clearTimeout(_liveOutputTimer)
    _liveOutputTimer = null
  }
  _liveOutputBatch = []
}
