// =============================================================
// EAA Agent Tools — 将 EAA Bridge 包装为 pi-agent-core AgentTool
// Agent 可以调用这些工具来查询/操作学生操行数据
// =============================================================

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { eaaBridge, getErrorMessage } from './eaa-bridge'

// 辅助函数：构造 TextContent 结果
function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

function jsonResult(data: unknown, summary: string): AgentToolResult<unknown> {
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
function extractData<T = unknown>(data: T | null, fallback = '(无数据)'): T | string {
  return data ?? fallback
}

// =============================================================
// Safe execute — 参数 sanitize 后调用 eaaBridge
// =============================================================

/**
 * 检查单个参数值是否安全
 * 拒绝：控制字符、shell 元字符、以 -- 开头的值（防止参数注入）
 */
function sanitizeArg(arg: string): void {
  // 拒绝控制字符（保留 \t \n \r）
  for (const ch of arg) {
    const code = ch.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new Error(`参数包含控制字符 (U+${code.toString(16).padStart(4, '0')})`)
    }
  }
  // 拒绝 shell 元字符
  // 修复：原正则 [class]#~!\\] 缺少 |，要求 6 字符序列才能匹配，单个 metachar 全部漏掉。
  // 现将 #、~、!、\\ 一并放入字符类，单个命中即拒绝。
  if (/[&|;`$(){}\\<>*?[\]#~!]/.test(arg)) {
    throw new Error(`参数包含非法 shell 元字符: ${JSON.stringify(arg)}`)
  }
  // 拒绝以 -- 开头的参数（防止参数注入）
  if (arg.startsWith('--')) {
    throw new Error(`参数不允许以 -- 开头: ${JSON.stringify(arg)}`)
  }
}

/**
 * 对用户提供的值做 sanitize 后转调 eaaBridge.execute
 * @param command  EAA 命令名
 * @param values   用户提供的值（将被 sanitize，不允许控制字符 / shell 元字符 / -- 开头）
 * @param flags    工具代码硬编码的 --flag 及其值（跳过 sanitize，因为是程序构造的）
 */
async function safeExecute(
  command: string,
  values: string[],
  flags: string[] = [],
): Promise<import('./eaa-bridge').EAAResult> {
  for (const val of values) {
    sanitizeArg(val)
  }
  return eaaBridge.execute({ command, args: [...values, ...flags] })
}

/** 支持双引号包裹复合词的 tokenize 实现，与 eaa-handlers.ts 一致 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) {
    tokens.push(current)
  }
  return tokens
}

// =============================================================
// Schema 定义
// =============================================================

const nameParam = Type.Object({
  name: Type.String({ description: '学生姓名' }),
})

const addEventParams = Type.Object({
  student_name: Type.String({ description: '学生姓名' }),
  reason_code: Type.String({
    description: '原因码（必须存在于 reason_codes.json 中，如 LATE, CLASS_MONITOR 等）',
  }),
  delta: Type.Optional(
    Type.Number({ description: '分数变动（-10 到 +10），如果原因码有固定分值可不填' }),
  ),
  note: Type.Optional(Type.String({ description: '备注说明' })),
  tags: Type.Optional(Type.String({ description: '标签，逗号分隔' })),
})

const searchParams = Type.Object({
  query: Type.String({ description: '搜索关键词' }),
  limit: Type.Optional(Type.Number({ description: '最大返回条数，默认 50' })),
})

const emptyParams = Type.Object({})

const rankingParams = Type.Object({
  n: Type.Optional(Type.Number({ description: '显示前 N 名，默认 10' })),
})

const summaryParams = Type.Object({
  since: Type.Optional(Type.String({ description: '起始日期 YYYY-MM-DD' })),
  until: Type.Optional(Type.String({ description: '截止日期 YYYY-MM-DD' })),
})

const rangeParams = Type.Object({
  start: Type.String({ description: '起始日期 YYYY-MM-DD' }),
  end: Type.String({ description: '截止日期 YYYY-MM-DD' }),
  limit: Type.Optional(Type.Number({ description: '最大返回条数，默认 100' })),
})

// =============================================================
// 1. 查询学生分数
// =============================================================
export const queryScoreTool: AgentTool<typeof nameParam> = {
  name: 'eaa_score',
  label: '查询学生分数',
  description: '查询指定学生的操行分数、风险等级和事件统计',
  parameters: nameParam,
  execute: async (_toolCallId, params) => {
    const result = await safeExecute('score', [params.name])
    if (!result.success) {
      throw new Error(`查询失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `${params.name} 的操行分数`)
  },
}

// =============================================================
// 2. 添加操行事件
// =============================================================
export const addEventTool: AgentTool<typeof addEventParams> = {
  name: 'eaa_add_event',
  label: '添加操行事件',
  description: '为指定学生添加一条操行事件（加分或扣分）',
  parameters: addEventParams,
  execute: async (_toolCallId, params) => {
    const values: string[] = [params.student_name, params.reason_code]
    const flags: string[] = []
    if (params.delta !== undefined) flags.push('--delta', String(params.delta))
    if (params.note) flags.push('--note', params.note)
    if (params.tags) flags.push('--tags', params.tags)
    const result = await safeExecute('add', values, flags)
    if (!result.success) {
      throw new Error(`添加事件失败: ${getErrorMessage(result)}`)
    }
    return textResult(`事件已添加: ${extractData(result.data)}`)
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
  execute: async (_toolCallId, params) => {
    const result = await safeExecute('history', [params.name])
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
  execute: async (_toolCallId, params) => {
    // RISK: 用 safeExecute + tokenizeQuery 替代直接 eaaBridge.execute,
    // 防止 Agent 注入含控制字符 / shell 元字符的 query 绕过 sanitize。
    // tokenizeQuery 仅做引号/空格分词,不做安全校验,
    // 必须由 safeExecute 在转给 eaa-bridge 前对每个 token 做 sanitize。
    const values = tokenizeQuery(params.query)
    const flags: string[] = []
    if (params.limit) flags.push('--limit', String(params.limit))
    const result = await safeExecute('search', values, flags)
    if (!result.success) {
      throw new Error(`搜索失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `"${params.query}" 的搜索结果`)
  },
}

// =============================================================
// 5. 列出所有学生
// =============================================================
export const listStudentsTool: AgentTool<typeof emptyParams> = {
  name: 'eaa_list_students',
  label: '列出所有学生',
  description: '获取所有学生的姓名、分数、风险等级概览',
  parameters: emptyParams,
  execute: async () => {
    const result = await eaaBridge.execute({ command: 'list-students', args: [] })
    if (!result.success) {
      throw new Error(`列表获取失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), '全部学生列表')
  },
}

// =============================================================
// 6. 查看排行榜
// =============================================================
export const rankingTool: AgentTool<typeof rankingParams> = {
  name: 'eaa_ranking',
  label: '查看排行榜',
  description: '查看操行分排行榜（默认前 10 名）',
  parameters: rankingParams,
  execute: async (_toolCallId, params) => {
    const args = params.n ? [String(params.n)] : []
    const result = await eaaBridge.execute({ command: 'ranking', args })
    if (!result.success) {
      throw new Error(`排行榜获取失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `排行榜 Top ${params.n ?? 10}`)
  },
}

// =============================================================
// 7. 查看统计数据
// =============================================================
export const statsTool: AgentTool<typeof emptyParams> = {
  name: 'eaa_stats',
  label: '查看统计数据',
  description: '获取操行系统的整体统计：学生数、事件数、分数分布、原因分布',
  parameters: emptyParams,
  execute: async () => {
    const result = await eaaBridge.execute({ command: 'stats', args: [] })
    if (!result.success) {
      throw new Error(`统计获取失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), '操行系统统计数据')
  },
}

// =============================================================
// 8. 查看可用原因码
// =============================================================
export const codesTool: AgentTool<typeof emptyParams> = {
  name: 'eaa_codes',
  label: '查看原因码',
  description: '列出所有可用的操行原因码（加分/扣分/系统/实验室），含分值',
  parameters: emptyParams,
  execute: async () => {
    const result = await eaaBridge.execute({ command: 'codes', args: [] })
    if (!result.success) {
      throw new Error(`原因码获取失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), '可用原因码列表')
  },
}

// =============================================================
// 9. 周期摘要
// =============================================================
export const summaryTool: AgentTool<typeof summaryParams> = {
  name: 'eaa_summary',
  label: '周期摘要',
  description: '查看指定时间段内的操行摘要：事件统计、风险分布、进步/退步排名',
  parameters: summaryParams,
  execute: async (_toolCallId, params) => {
    const values: string[] = []
    const flags: string[] = []
    if (params.since) flags.push('--since', params.since)
    if (params.until) flags.push('--until', params.until)
    const result = await safeExecute('summary', values, flags)
    if (!result.success) {
      throw new Error(`摘要获取失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), '周期摘要')
  },
}

// =============================================================
// 10. 添加新学生
// =============================================================
export const addStudentTool: AgentTool<typeof nameParam> = {
  name: 'eaa_add_student',
  label: '添加学生',
  description: '在操行系统中注册一名新学生',
  parameters: nameParam,
  execute: async (_toolCallId, params) => {
    const result = await safeExecute('add-student', [params.name])
    if (!result.success) {
      throw new Error(`添加学生失败: ${getErrorMessage(result)}`)
    }
    return textResult(`学生已添加: ${params.name}`)
  },
}

// =============================================================
// 11. 日期范围查询
// =============================================================
export const rangeTool: AgentTool<typeof rangeParams> = {
  name: 'eaa_range',
  label: '日期范围查询',
  description: '查询指定日期范围内的所有操行事件',
  parameters: rangeParams,
  execute: async (_toolCallId, params) => {
    const values: string[] = [params.start, params.end]
    const flags: string[] = []
    if (params.limit) flags.push('--limit', String(params.limit))
    const result = await safeExecute('range', values, flags)
    if (!result.success) {
      throw new Error(`范围查询失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `${params.start} ~ ${params.end} 事件`)
  },
}

// =============================================================
// 导出：按能力分组的工具集
// =============================================================

/** 全部 EAA 工具 */
export const allEAATools: AnyAgentTool[] = [
  queryScoreTool,
  addEventTool,
  historyTool,
  searchEventsTool,
  listStudentsTool,
  rankingTool,
  statsTool,
  codesTool,
  summaryTool,
  addStudentTool,
  rangeTool,
]

// biome-ignore lint/suspicious/noExplicitAny: 异构工具集合，TSchema 约束不兼容 unknown
type AnyAgentTool = AgentTool<any>

/** 按 capability 名称匹配工具 */
export function getToolsByCapability(capabilities: string[]): AnyAgentTool[] {
  const capSet = new Set(capabilities.map((c) => c.toLowerCase()))
  if (capSet.has('all') || capSet.has('*')) return allEAATools

  const mapping: Record<string, AnyAgentTool[]> = {
    score: [queryScoreTool],
    add_event: [addEventTool],
    history: [historyTool],
    search: [searchEventsTool],
    list: [listStudentsTool],
    ranking: [rankingTool],
    stats: [statsTool],
    codes: [codesTool],
    summary: [summaryTool],
    add_student: [addStudentTool],
    range: [rangeTool],
    read: [
      queryScoreTool,
      historyTool,
      searchEventsTool,
      listStudentsTool,
      rankingTool,
      statsTool,
      codesTool,
      summaryTool,
      rangeTool,
    ],
    write: [addEventTool, addStudentTool],
  }

  const tools = new Set<AnyAgentTool>()
  for (const cap of capSet) {
    const matched = mapping[cap]
    if (matched) {
      for (const tool of matched) tools.add(tool)
    }
  }
  return Array.from(tools)
}
