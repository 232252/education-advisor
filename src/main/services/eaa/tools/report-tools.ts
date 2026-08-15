// =============================================================
// EAA Tools — 统计报表类工具(list / ranking / stats / codes / summary / range)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { eaaBridge, getErrorMessage } from '../../eaa-bridge'
import { safeExecute } from './sanitize'
import { emptyParams, extractData, jsonResult } from './shared'

// =============================================================
// Schema 定义
// =============================================================

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
// 5. 列出所有学生
// =============================================================
export const listStudentsTool: AgentTool<typeof emptyParams> = {
  name: 'eaa_list_students',
  label: '列出所有学生',
  description: '获取所有学生的姓名、分数、风险等级概览',
  parameters: emptyParams,
  execute: async (_toolCallId, _params, signal) => {
    // 仅 signal 存在时才传第二参(保持无 signal 时单参调用契约)
    const result = await (signal
      ? eaaBridge.execute({ command: 'list-students', args: [] }, { signal })
      : eaaBridge.execute({ command: 'list-students', args: [] }))
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
  execute: async (_toolCallId, params, signal) => {
    // R86 软发现-1 修复：校验 n 类型，拒绝 NaN/Infinity/非正数/非数字
    // 之前 ranking(-1/NaN/1e10/'abc') 全部返回 success（EAA 端容忍任意 n 并回退到 full ranking）
    if (
      params.n !== undefined &&
      (typeof params.n !== 'number' || !Number.isFinite(params.n) || params.n <= 0)
    ) {
      throw new Error(`参数 n 必须是正整数,收到: ${JSON.stringify(params.n)}`)
    }
    const args = params.n ? [String(params.n)] : []
    // 仅 signal 存在时才传第二参(保持无 signal 时单参调用契约)
    const result = await (signal
      ? eaaBridge.execute({ command: 'ranking', args }, { signal })
      : eaaBridge.execute({ command: 'ranking', args }))
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
  execute: async (_toolCallId, _params, signal) => {
    // 仅 signal 存在时才传第二参(保持无 signal 时单参调用契约)
    const result = await (signal
      ? eaaBridge.execute({ command: 'stats', args: [] }, { signal })
      : eaaBridge.execute({ command: 'stats', args: [] }))
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
  execute: async (_toolCallId, _params, signal) => {
    // 仅 signal 存在时才传第二参(保持无 signal 时单参调用契约)
    const result = await (signal
      ? eaaBridge.execute({ command: 'codes', args: [] }, { signal })
      : eaaBridge.execute({ command: 'codes', args: [] }))
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
  execute: async (_toolCallId, params, signal) => {
    const values: string[] = []
    const flags: string[] = []
    if (params.since) flags.push('--since', params.since)
    if (params.until) flags.push('--until', params.until)
    const result = await safeExecute('summary', values, flags, signal)
    if (!result.success) {
      throw new Error(`摘要获取失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), '周期摘要')
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
  execute: async (_toolCallId, params, signal) => {
    const values: string[] = [params.start, params.end]
    const flags: string[] = []
    if (params.limit) flags.push('--limit', String(params.limit))
    const result = await safeExecute('range', values, flags, signal)
    if (!result.success) {
      throw new Error(`范围查询失败: ${getErrorMessage(result)}`)
    }
    return jsonResult(extractData(result.data), `${params.start} ~ ${params.end} 事件`)
  },
}
