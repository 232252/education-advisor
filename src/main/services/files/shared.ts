// =============================================================
// File Tools — 共享辅助: 结果构造
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentToolResult } from '@main/services/llm-contracts'

// 辅助函数
export function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

/**
 * 工具结果字符上限(2026-08-28 智能轮)。
 * 此前 read_file 可把 5MB 文本原样返回(≈百万 token),一次调用即把后续所有轮次
 * 的上下文永久顶满,消息留驻直到压缩 — 模型注意力和成本都被挤爆。
 * 取 20K 字符 ≈ 5K~12K token,足够容纳一屏完整信息,又给对话留出充足空间。
 */
export const MAX_TOOL_RESULT_CHARS = 20000

/**
 * 按字符截断工具结果,附续读指引(模型可据此自纠,分页取回剩余内容)。
 * @param content 完整文本
 * @param offset 本次起始字符偏移(分页续读的锚点)
 * @param nextAction 超限时附加的行动指引(默认提示用 offset 续读;无分页参数的工具传自定义指引)
 * @returns 截断后的文本;未超限则原样返回
 */
export function truncateForResult(content: string, offset = 0, nextAction?: string): string {
  const total = content.length
  const slice = content.slice(offset, offset + MAX_TOOL_RESULT_CHARS)
  if (offset + slice.length >= total) {
    return offset > 0
      ? `${slice}\n\n[分页] 已返回第 ${offset}~${total} 字符(文件到此结束)。`
      : slice
  }
  const next = offset + slice.length
  const action = nextAction ?? `如需后续内容,请用 offset=${next} 参数再次调用。`
  return `${slice}\n\n[已截断] 文件共 ${total} 字符,本次返回第 ${offset}~${next} 字符。${action}`
}
