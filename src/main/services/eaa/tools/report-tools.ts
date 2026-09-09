// =============================================================
// EAA Tools — 统计报表类工具(list / ranking / stats / codes / summary / range)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { executeWithSignal, safeExecute } from './sanitize'
import {
  assertEaaSuccess,
  emptyParams,
  extractData,
  jsonResult,
  withTruncationNotice,
} from './shared'

// =============================================================
// Schema 定义
// =============================================================

const rankingParams = Type.Object({
  n: Type.Optional(Type.Number({ description: '显示前 N 名，默认 10' })),
})

const summaryParams = Type.Object({
  since: Type.Optional(Type.String({ description: '起始日期 YYYY-MM-DD(也可用 start,二者等价)' })),
  until: Type.Optional(Type.String({ description: '截止日期 YYYY-MM-DD(也可用 end,二者等价)' })),
  start: Type.Optional(
    Type.String({ description: '起始日期 YYYY-MM-DD(since 的别名,与其他工具统一口径)' }),
  ),
  end: Type.Optional(
    Type.String({ description: '截止日期 YYYY-MM-DD(until 的别名,与其他工具统一口径)' }),
  ),
})

const rangeParams = Type.Object({
  start: Type.String({ description: '起始日期 YYYY-MM-DD' }),
  end: Type.String({ description: '截止日期 YYYY-MM-DD' }),
  limit: Type.Optional(Type.Number({ description: '最大返回条数，默认 100' })),
})

// =============================================================
// 5. 列出所有学生
// =============================================================
/** 单次注入的学生条数上限 — 大库(千级学生)全量 JSON 一次能挤占数十 K token,把当前任务细节挤出上下文 */
const MAX_STUDENTS_LISTED = 200

export const listStudentsTool: AgentTool<typeof emptyParams> = {
  name: 'eaa_list_students',
  label: '列出所有学生',
  description:
    '获取所有学生的姓名、分数、风险等级概览(按姓名排序,超过 200 名时只返回前 200 并标注截断)',
  parameters: emptyParams,
  execute: async (_toolCallId, _params, signal) => {
    const result = await executeWithSignal({ command: 'list-students', args: [] }, signal)
    assertEaaSuccess(result, '列表获取失败')
    const data = extractData(result.data) as {
      students?: unknown[]
      total?: number
      [key: string]: unknown
    }
    if (Array.isArray(data.students) && data.students.length > MAX_STUDENTS_LISTED) {
      const total = typeof data.total === 'number' ? data.total : data.students.length
      return jsonResult(
        {
          ...data,
          students: data.students.slice(0, MAX_STUDENTS_LISTED),
          students_truncated: `仅返回前 ${MAX_STUDENTS_LISTED}/${total} 名(按姓名排序)。要核对特定学生请用 eaa_search,要看按分数排序的名单请用 eaa_ranking(传足够大的 n)`,
        },
        '全部学生列表',
      )
    }
    return jsonResult(data, '全部学生列表')
  },
}

// =============================================================
// 6. 查看排行榜
// =============================================================
export const rankingTool: AgentTool<typeof rankingParams> = {
  name: 'eaa_ranking',
  label: '查看排行榜',
  description:
    '查看操行分排行榜,按分数从高到低排列(默认前 10 名)。注意: 这是高分榜 — 要找低分/高风险学生时,传足够大的 n(如 999)取全量名单,从列表末尾找分数最低的学生',
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
    const result = await executeWithSignal({ command: 'ranking', args }, signal)
    assertEaaSuccess(result, '排行榜获取失败')
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
    const result = await executeWithSignal({ command: 'stats', args: [] }, signal)
    assertEaaSuccess(result, '统计获取失败')
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
    const result = await executeWithSignal({ command: 'codes', args: [] }, signal)
    assertEaaSuccess(result, '原因码获取失败')
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
    // start/end 是 since/until 的别名 — 区间参数此前两套叫法(since/until vs start/end),
    // 模型在相邻调用间容易串参;两个都传时显式 since/until 优先
    const since = params.since ?? params.start
    const until = params.until ?? params.end
    const values: string[] = []
    const flags: string[] = []
    if (since) flags.push('--since', since)
    if (until) flags.push('--until', until)
    const result = await safeExecute('summary', values, flags, signal)
    assertEaaSuccess(result, '摘要获取失败')
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
    // L2 修复: 显式传默认值 — 与参数描述"默认 100"对齐(此前不传时由 CLI 自行决定)
    flags.push('--limit', String(params.limit ?? 100))
    const result = await safeExecute('range', values, flags, signal)
    assertEaaSuccess(result, '范围查询失败')
    const data = extractData(result.data) as {
      total?: number
      showing?: number
      [key: string]: unknown
    }
    return withTruncationNotice(
      data,
      `${params.start} ~ ${params.end} 事件`,
      '需要完整数据请调大 limit 参数',
    )
  },
}
