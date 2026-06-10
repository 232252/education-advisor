// =============================================================
// EAA Agent Tools — 将 EAA Bridge 包装为 pi-agent-core AgentTool
// Agent 可以调用这些工具来查询/操作学生操行数据
// =============================================================

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { tokenizeQuery } from '../../shared/utils'
import { eaaBridge, getErrorMessage } from './eaa-bridge'
import { profileService } from './profile-service'

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

/** B-24: tokenizeQuery 改在 shared/utils.ts 实现 (本地删除) */

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
    const args = tokenizeQuery(params.query)
    if (params.limit) args.push('--limit', String(params.limit))
    const result = await eaaBridge.execute({ command: 'search', args })
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
// 12. 获取学业成绩
// =============================================================
const academicScoreParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
})

export const getAcademicScoresTool: AgentTool<typeof academicScoreParams> = {
  name: 'eaa_academic_get',
  label: '获取学业成绩',
  description: '获取指定学生的全部学业考试成绩记录（支持任意科目和考试类型）',
  parameters: academicScoreParams,
  execute: async (_toolCallId, params) => {
    // sanitize: 防止路径遍历 / prompt injection
    const safeName = params.name.replace(/[^\u4e00-\u9fff_a-zA-Z0-9-]/g, '_').slice(0, 64)
    if (!safeName.trim()) throw new Error('invalid student name')
    const records = await profileService.getAcademicRecords(safeName)
    return jsonResult(records, `${safeName} 的学业成绩`)
  },
}

// =============================================================
// 13. 添加学业考试记录
// =============================================================
const addExamParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  examType: Type.String({ description: '考试类型（月考/周考/期中/期末/模拟考/平时测试/自定义）' }),
  examName: Type.String({ description: '考试名称（如"月考1"、"2026-03-14周考"）' }),
  subjects: Type.Record(Type.String(), Type.Number(), {
    description: '科目及成绩，如 {"语文":95, "数学":88}',
  }),
  date: Type.Optional(Type.String({ description: '考试日期 YYYY-MM-DD（可选）' })),
  notes: Type.Optional(Type.String({ description: '备注（可选）' })),
})

export const addAcademicExamTool: AgentTool<typeof addExamParams> = {
  name: 'eaa_academic_add',
  label: '添加考试成绩',
  description: '为指定学生添加一条学业考试成绩记录，支持任意科目和考试类型',
  parameters: addExamParams,
  execute: async (_toolCallId, params) => {
    // sanitize: 防止路径遍历 / prompt injection
    const safeName = params.name.replace(/[^\u4e00-\u9fff_a-zA-Z0-9-]/g, '_').slice(0, 64)
    if (!safeName.trim()) throw new Error('invalid student name')
    const result = await profileService.addAcademicRecord(safeName, {
      examType: params.examType,
      examName: params.examName,
      subjects: params.subjects,
      date: params.date,
      notes: params.notes,
    })
    if (!result.success) {
      throw new Error(`添加成绩失败: ${result.error}`)
    }
    return textResult(`已为 ${params.name} 添加 ${params.examName} 成绩`)
  },
}

// =============================================================
// 14. 撤销事件
// =============================================================
const revertEventParams = Type.Object({
  event_id: Type.String({ description: '事件 ID' }),
  reason: Type.Optional(Type.String({ description: '撤销原因' })),
})

export const revertEventTool: AgentTool<typeof revertEventParams> = {
  name: 'eaa_revert_event',
  label: '撤销事件',
  description: '撤销指定学生的操行事件（扣分或加分），分数将回退',
  parameters: revertEventParams,
  execute: async (_toolCallId, params) => {
    const safeId = params.event_id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    if (!safeId) throw new Error('invalid event_id')
    const flags = [
      '--reason',
      params.reason?.replace(/[^\u4e00-\u9fff_a-zA-Z0-9-]/g, '_').slice(0, 128) || 'agent revert',
    ]
    const result = await eaaBridge.execute({ command: 'revert', args: [safeId, ...flags] })
    if (!result.success) {
      throw new Error(`撤销事件失败: ${result.stderr || 'unknown error'}`)
    }
    return textResult(`事件 ${safeId} 已撤销`)
  },
}

// =============================================================
// 15. 读取学生扩展档案
// =============================================================
const profileGetParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  fields: Type.Optional(
    Type.Array(Type.String(), {
      description: '可选：仅返回指定字段（如 ["phone","fatherName"]），不传则返回全部档案字段',
    }),
  ),
})

export const getProfileTool: AgentTool<typeof profileGetParams> = {
  name: 'eaa_profile_get',
  label: '读取学生档案',
  description:
    '读取学生扩展档案（联系方式、家庭信息、健康信息、在校信息、奖惩记录、备注等），可指定字段',
  parameters: profileGetParams,
  execute: async (_toolCallId, params) => {
    const safeName = params.name.replace(/[^一-鿿_a-zA-Z0-9-]/g, '_').slice(0, 64)
    if (!safeName.trim()) throw new Error('invalid student name')
    const data = await profileService.get(safeName)
    if (!data || Object.keys(data).length === 0) {
      return textResult(`学生 ${safeName} 暂无扩展档案`)
    }
    let result: Record<string, unknown> = data
    if (params.fields && params.fields.length > 0) {
      result = {}
      for (const f of params.fields) {
        if (f in data) result[f] = data[f]
      }
    }
    return jsonResult(result, `${safeName} 的扩展档案`)
  },
}

// =============================================================
// 16. 写入/更新学生扩展档案
// =============================================================
/**
 * 允许的字段白名单 — 与 StudentProfileData 保持一致。
 * 数组字段自动转换；非白名单字段直接忽略。
 */
const PROFILE_WRITABLE_FIELDS = new Set([
  'idCard',
  'gender',
  'birthDate',
  'politicalStatus',
  'ethnicity',
  'householdRegister',
  'currentAddress',
  'isBoarding',
  'isOnlyChild',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'medicalHistory',
  'economicStatus',
  'phone',
  'email',
  'address',
  'parentName',
  'parentPhone',
  'fatherName',
  'fatherPhone',
  'motherName',
  'motherPhone',
  'enrollmentDate',
  'classId',
  'comments',
  'classRank',
  'gradeRank',
  'attendanceRate',
  'awards',
  'customSubjects',
])

const PROFILE_STRING_FIELDS = new Set([
  'idCard',
  'gender',
  'birthDate',
  'politicalStatus',
  'ethnicity',
  'householdRegister',
  'currentAddress',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'medicalHistory',
  'economicStatus',
  'phone',
  'email',
  'address',
  'parentName',
  'parentPhone',
  'fatherName',
  'fatherPhone',
  'motherName',
  'motherPhone',
  'enrollmentDate',
  'classId',
  'comments',
])

const PROFILE_NUMBER_FIELDS = new Set(['classRank', 'gradeRank', 'attendanceRate'])
const PROFILE_BOOLEAN_FIELDS = new Set(['isBoarding', 'isOnlyChild'])
const PROFILE_STRING_ARRAY_FIELDS = new Set(['awards', 'customSubjects'])

const profileSetParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  fields: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
    description:
      '要写入的字段及值。字符串字段传 string；数字字段（classRank/gradeRank/attendanceRate）传 number；布尔字段（isBoarding/isOnlyChild）传 boolean。',
  }),
})

export const setProfileTool: AgentTool<typeof profileSetParams> = {
  name: 'eaa_profile_set',
  label: '更新学生档案',
  description:
    '更新学生扩展档案的任意字段（联系方式、家庭信息、健康信息、在校信息、奖惩、备注等）。已存在的字段会被覆盖，未列出的字段保持不变。',
  parameters: profileSetParams,
  execute: async (_toolCallId, params) => {
    const safeName = params.name.replace(/[^一-鿿_a-zA-Z0-9-]/g, '_').slice(0, 64)
    if (!safeName.trim()) throw new Error('invalid student name')

    // 字段白名单 + 类型校验
    const patch: Record<string, unknown> = {}
    const rejected: string[] = []
    for (const [k, v] of Object.entries(params.fields)) {
      if (!PROFILE_WRITABLE_FIELDS.has(k)) {
        rejected.push(k)
        continue
      }
      if (PROFILE_STRING_FIELDS.has(k)) {
        if (typeof v !== 'string') {
          throw new Error(`字段 ${k} 应为字符串, 收到 ${typeof v}`)
        }
        patch[k] = v
      } else if (PROFILE_NUMBER_FIELDS.has(k)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`字段 ${k} 应为有限数字, 收到 ${typeof v}`)
        }
        patch[k] = v
      } else if (PROFILE_BOOLEAN_FIELDS.has(k)) {
        if (typeof v !== 'boolean') {
          throw new Error(`字段 ${k} 应为布尔值, 收到 ${typeof v}`)
        }
        patch[k] = v
      } else if (PROFILE_STRING_ARRAY_FIELDS.has(k)) {
        if (typeof v !== 'string') {
          throw new Error(`字段 ${k} 应为字符串(JSON 数组或换行分隔), 收到 ${typeof v}`)
        }
        // 接受 JSON 数组 或 换行/逗号分隔
        const trimmed = v.trim()
        let arr: string[] = []
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed)
            if (Array.isArray(parsed)) arr = parsed.map(String)
            else
              arr = v
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean)
          } catch {
            arr = v
              .split(/[\n,]/)
              .map((s) => s.trim())
              .filter(Boolean)
          }
        } else {
          arr = v
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        }
        patch[k] = arr
      }
    }
    if (rejected.length > 0) {
      console.warn(`[setProfileTool] ignored non-writable fields: ${rejected.join(', ')}`)
    }
    if (Object.keys(patch).length === 0) {
      return textResult('无可写入字段（均不在白名单内）')
    }

    const result = await profileService.update(safeName, patch)
    if (!result.success) {
      throw new Error(`档案更新失败: ${result.error ?? 'unknown error'}`)
    }
    return textResult(
      `已更新 ${safeName} 的 ${Object.keys(patch).length} 个档案字段: ${Object.keys(patch).join(', ')}`,
    )
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
  getAcademicScoresTool,
  addAcademicExamTool,
  revertEventTool,
  getProfileTool,
  setProfileTool,
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
    revert: [revertEventTool],
    academic: [getAcademicScoresTool, addAcademicExamTool],
    profile: [getProfileTool, setProfileTool],
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
      getAcademicScoresTool,
      getProfileTool,
    ],
    write: [addEventTool, addStudentTool, addAcademicExamTool, revertEventTool, setProfileTool],
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
