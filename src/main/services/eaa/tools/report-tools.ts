// =============================================================
// EAA Tools — 统计报表类工具(list / ranking / stats / codes / summary / range)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { profileService } from '../../profile-service'
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
  class_id: Type.Optional(
    Type.String({
      description:
        '只看该班。教师问「我们班/高三5班排名」时必须传，否则会把课任班和其他班混在一起。',
    }),
  ),
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

const listStudentsParams = Type.Object({
  class_id: Type.Optional(
    Type.String({
      description:
        '只列出该班级学生。核对某班花名册、查「我们班有哪些人」时必须传。不填会返回全校，容易把其他班的人当成该班的人。',
    }),
  ),
})

/** 单次注入的学生条数上限 — 大库(千级学生)全量 JSON 一次能挤占数十 K token,把当前任务细节挤出上下文 */
const MAX_STUDENTS_LISTED = 200

function studentClassId(row: unknown): string {
  if (!row || typeof row !== 'object') return ''
  const cid = (row as { class_id?: unknown }).class_id
  return typeof cid === 'string' ? cid : ''
}

export const listStudentsTool: AgentTool<typeof listStudentsParams> = {
  name: 'eaa_list_students',
  label: '列出学生',
  description:
    '列出学生姓名、分数、风险、班级、学号/考号（来自档案，便于对成绩表和卷面）。核对某班花名册时必须传 class_id，不要用全校名单冒充该班。超过 200 名时截断。',
  parameters: listStudentsParams,
  execute: async (_toolCallId, params, signal) => {
    const result = await executeWithSignal({ command: 'list-students', args: [] }, signal)
    assertEaaSuccess(result, '列表获取失败')
    const data = extractData(result.data) as {
      students?: unknown[]
      total?: number
      [key: string]: unknown
    }
    let students = Array.isArray(data.students) ? data.students : []
    const classId = params.class_id?.trim()
    if (classId) {
      students = students.filter((s) => studentClassId(s) === classId)
    }
    const total = students.length
    const truncated = students.length > MAX_STUDENTS_LISTED
    const listed = truncated ? students.slice(0, MAX_STUDENTS_LISTED) : students
    const withNumbers = await Promise.all(
      listed.map(async (s) => {
        if (!s || typeof s !== 'object') return s
        const name = (s as { name?: unknown }).name
        if (typeof name !== 'string' || !name.trim()) return s
        const profile = await profileService.get(name)
        const extra: { student_number?: string; exam_number?: string } = {}
        if (typeof profile.studentNumber === 'string' && profile.studentNumber.trim()) {
          extra.student_number = profile.studentNumber.trim()
        }
        if (typeof profile.examNumber === 'string' && profile.examNumber.trim()) {
          extra.exam_number = profile.examNumber.trim()
        }
        return Object.keys(extra).length > 0 ? { ...s, ...extra } : s
      }),
    )
    return jsonResult(
      {
        ...data,
        class_id: classId || undefined,
        students: withNumbers,
        total,
        names: withNumbers
          .map((s) => (s && typeof s === 'object' ? (s as { name?: string }).name : ''))
          .filter((n): n is string => Boolean(n)),
        students_truncated: truncated
          ? `仅返回前 ${MAX_STUDENTS_LISTED}/${total} 名。要核对特定学生请用 eaa_score，要看按分数排序请用 eaa_ranking({ class_id, n: 999 })`
          : undefined,
      },
      classId ? `${classId} 学生 ${total} 人` : '全部学生列表',
    )
  },
}

// =============================================================
// 6. 查看排行榜
// =============================================================
export const rankingTool: AgentTool<typeof rankingParams> = {
  name: 'eaa_ranking',
  label: '查看排行榜',
  description:
    '查看操行分排行榜，按分数从高到低。教师问某班排名时必须传 class_id。' +
    '这是高分榜 — 找低分/高风险学生时传足够大的 n（如 999），从列表末尾看。',
  parameters: rankingParams,
  execute: async (_toolCallId, params, signal) => {
    if (
      params.n !== undefined &&
      (typeof params.n !== 'number' || !Number.isFinite(params.n) || params.n <= 0)
    ) {
      throw new Error(`参数 n 必须是正整数,收到: ${JSON.stringify(params.n)}`)
    }
    const classId = params.class_id?.trim()
    const fetchN = classId ? Math.max(params.n ?? 0, 9999) : params.n
    const args = fetchN ? [String(fetchN)] : []
    const result = await executeWithSignal({ command: 'ranking', args }, signal)
    assertEaaSuccess(result, '排行榜获取失败')
    const data = extractData(result.data) as {
      ranking?: Array<{ name?: string; class_id?: string; [k: string]: unknown }>
      [k: string]: unknown
    }
    if (!classId) {
      return jsonResult(data, `排行榜 Top ${params.n ?? 10}`)
    }
    const ranking = Array.isArray(data.ranking) ? data.ranking : []
    const filtered = ranking.filter((row) => row.class_id === classId)
    const limit = params.n ?? filtered.length
    const sliced = filtered.slice(0, limit)
    return jsonResult(
      {
        ...data,
        class_id: classId,
        ranking: sliced,
        total: filtered.length,
      },
      `${classId} 排行榜 ${sliced.length}/${filtered.length} 人`,
    )
  },
}

// =============================================================
// 7. 查看统计数据
// =============================================================
export const statsTool: AgentTool<typeof emptyParams> = {
  name: 'eaa_stats',
  label: '查看统计数据',
  description:
    '获取操行系统的整体统计（全校）。看某一个班请用 eaa_list_students({ class_id }) 和 eaa_ranking({ class_id })，不要把课任班和其他班混在一起。',
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
