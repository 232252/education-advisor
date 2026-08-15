// =============================================================
// EAA Tools — 学生/事件查询类工具(score / history / search / tag)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { getErrorMessage } from '../../eaa-bridge'
import { safeExecute, tokenizeQuery } from './sanitize'
import { extractData, jsonResult, nameParam } from './shared'

// =============================================================
// Schema 定义
// =============================================================

const searchParams = Type.Object({
  query: Type.String({ description: '搜索关键词' }),
  limit: Type.Optional(Type.Number({ description: '最大返回条数，默认 50' })),
})

const tagParams = Type.Object({
  tag: Type.Optional(Type.String({ description: '标签名。不填则列出所有已知标签' })),
})

// =============================================================
// 1. 查询学生分数
// =============================================================
export const queryScoreTool: AgentTool<typeof nameParam> = {
  name: 'eaa_score',
  label: '查询学生分数',
  description: '查询指定学生的操行分数、风险等级和事件统计',
  parameters: nameParam,
  execute: async (_toolCallId, params, signal) => {
    const result = await safeExecute('score', [params.name], [], signal)
    if (!result.success) {
      throw new Error(`查询失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `${params.name} 的操行分数`)
  },
}

// =============================================================
// 3. 查看学生事件历史
// =============================================================
export const historyTool: AgentTool<typeof nameParam> = {
  name: 'eaa_history',
  label: '查看事件历史',
  description: '查看指定学生的完整操行事件时间线',
  parameters: nameParam,
  execute: async (_toolCallId, params, signal) => {
    const result = await safeExecute('history', [params.name], [], signal)
    if (!result.success) {
      throw new Error(`查询历史失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `${params.name} 的事件历史`)
  },
}

// =============================================================
// 4. 搜索事件
// =============================================================
export const searchEventsTool: AgentTool<typeof searchParams> = {
  name: 'eaa_search',
  label: '搜索事件',
  description: '按关键词搜索操行事件（匹配学生姓名、原因码、标签等）',
  parameters: searchParams,
  execute: async (_toolCallId, params, signal) => {
    // RISK: 用 safeExecute + tokenizeQuery 替代直接 eaaBridge.execute,
    // 防止 Agent 注入含控制字符 / shell 元字符的 query 绕过 sanitize。
    // tokenizeQuery 仅做引号/空格分词,不做安全校验,
    // 必须由 safeExecute 在转给 eaa-bridge 前对每个 token 做 sanitize。
    const values = tokenizeQuery(params.query)
    const flags: string[] = []
    if (params.limit) flags.push('--limit', String(params.limit))
    const result = await safeExecute('search', values, flags, signal)
    if (!result.success) {
      throw new Error(`搜索失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `"${params.query}" 的搜索结果`)
  },
}

// =============================================================
// 14. 标签查询 — 对应 eaa:tag (GAP-1 补全)
// =============================================================
export const tagTool: AgentTool<typeof tagParams> = {
  name: 'eaa_tag',
  label: '标签查询',
  description: '按标签查询学生/事件，或不带参数列出所有可用标签',
  parameters: tagParams,
  execute: async (_toolCallId, params, signal) => {
    const values = params.tag ? [params.tag] : []
    const result = await safeExecute('tag', values, [], signal)
    if (!result.success) {
      throw new Error(`标签查询失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(
      extractData(result.data),
      params.tag ? `标签 "${params.tag}" 的结果` : '所有标签',
    )
  },
}
