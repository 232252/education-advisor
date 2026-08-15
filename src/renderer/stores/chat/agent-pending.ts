// =============================================================
// Agent pending output 缓存 — 模块级状态(避免 re-render)
// =============================================================

/** CONCERN 修复: 切走 agent 期间的 pending output 缓存,切回时合并
 *  避免 R-1 修复引入的"切走期间文本丢失"问题
 *  使用模块级变量而非 Zustand 状态,避免不必要的 re-render
 *  L-10 修复: 限制最大条目数,防止 agent 崩溃且不发事件时内存泄漏 */
export const MAX_PENDING_AGENTS = 10
export const pendingAgentOutputs = new Map<string, string[]>()
