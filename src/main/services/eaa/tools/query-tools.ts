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

const historyParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  limit: Type.Optional(
    Type.Number({
      description: '最多返回的最近事件条数，默认 50(完整时间线条数在 events_count 字段)',
    }),
  ),
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
export const historyTool: AgentTool<typeof historyParams> = {
  name: 'eaa_history',
  label: '查看事件历史',
  description:
    '查看指定学生的操行事件时间线(默认只返回最近 50 条,完整条数见 events_count;需要更早记录可调大 limit)',
  parameters: historyParams,
  execute: async (_toolCallId, params, signal) => {
    const result = await safeExecute('history', [params.name], [], signal)
    if (!result.success) {
      throw new Error(`查询历史失败: ${getErrorMessage(result)}`)
    }
    // H4 修复(2026-08-28 智能轮): CLI history 无 --limit 参数且全量返回 —
    // 老学生全时间线(数百条 pretty JSON)一次就能挤爆上下文。
    // 此处 JS 侧截取最近 N 条(事件按时间升序,保留尾部即最近),
    // 完整条数在 events_count,截断信息在 events_truncated。
    const data = extractData(result.data) as {
      events?: unknown[]
      events_count?: number
      [key: string]: unknown
    }
    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 50
    if (Array.isArray(data.events) && data.events.length > limit) {
      return jsonResult(
        {
          ...data,
          events: data.events.slice(-limit),
          events_truncated: `仅返回最近 ${limit}/${data.events.length} 条,完整时间线条数见 events_count`,
        },
        `${params.name} 的事件历史`,
      )
    }
    return jsonResult(data, `${params.name} 的事件历史`)
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
    // L2 修复: 显式传默认值 — 此前不传 limit 时由 CLI 决定,与参数描述"默认 50"不符,
    // 模型按错误心智做分页决策会失准
    flags.push('--limit', String(params.limit ?? 50))
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
