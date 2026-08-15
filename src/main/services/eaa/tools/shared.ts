// =============================================================
// EAA Tools — 共享辅助: 结果构造与公共参数 schema
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

// 辅助函数：构造 TextContent 结果
export function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

export function jsonResult(data: unknown, summary: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    details: { summary },
  }
}

/**
 * 从 EAAResult.data 中提取值：
 * JSON 命令返回的对象直接使用；
 * null 时返回 fallback 文本
 */
export function extractData<T = unknown>(data: T | null, fallback = '(无数据)'): T | string {
  return data ?? fallback
}

// =============================================================
// 公共参数 schema(多个工具文件共用)
// =============================================================

export const nameParam = Type.Object({
  name: Type.String({ description: '学生姓名' }),
})

export const emptyParams = Type.Object({})
