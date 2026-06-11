// =============================================================
// EAA Agent Tools — 将 EAA Bridge 包装为 pi-agent-core AgentTool
// Agent 可以调用这些工具来查询/操作学生操行数据
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { app } from 'electron'
import { Type } from 'typebox'
import { tokenizeQuery } from '../../shared/utils'
import { eaaBridge, getErrorMessage } from './eaa-bridge'

// Lazy-loaded to avoid pulling in electron's `app` module during test imports.
// ProfileService's constructor calls `app.getPath('userData')`, which crashes
// in unit-test envs that mock `./eaa-bridge` but not `electron`. Loading it
// inside `getProfileService()` defers the side effect to first call.
let _profileService: typeof import('./profile-service').profileService | null = null
async function getProfileService() {
  if (!_profileService) {
    _profileService = (await import('./profile-service')).profileService
  }
  return _profileService
}

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
    const records = await (await getProfileService()).getAcademicRecords(safeName)
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
  subjects: Type.Record(Type.String(), Type.Union([Type.Number(), Type.Null()]), {
    description:
      '科目及成绩, 数字 0-300 或 null (缺考). 例: {"语文":95, "数学":88, "英语":null} 表示英语缺考',
  }),
  date: Type.Optional(Type.String({ description: '考试日期 YYYY-MM-DD（可选）' })),
  notes: Type.Optional(Type.String({ description: '备注（可选）' })),
})

export const addAcademicExamTool: AgentTool<typeof addExamParams> = {
  name: 'eaa_academic_add',
  label: '添加考试成绩',
  description:
    '为指定学生添加一条学业考试成绩记录, 支持任意科目和考试类型. 缺考科目传 null (不是 0, 0 表示 0 分)',
  parameters: addExamParams,
  execute: async (_toolCallId, params) => {
    // sanitize: 防止路径遍历 / prompt injection
    const safeName = params.name.replace(/[^\u4e00-\u9fff_a-zA-Z0-9-]/g, '_').slice(0, 64)
    if (!safeName.trim()) throw new Error('invalid student name')
    const result = await (await getProfileService()).addAcademicRecord(safeName, {
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
    const data = await (await getProfileService()).get(safeName)
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
    '更新学生扩展档案字段。仅白名单内的 30 个字段会被接受, 其他字段会被静默忽略。\n' +
    '**字符串字段** (传 string): idCard, gender, birthDate, politicalStatus, ethnicity, householdRegister, currentAddress, emergencyContactName, emergencyContactPhone, emergencyContactRelation, medicalHistory, economicStatus, phone, email, address, parentName, parentPhone, fatherName, fatherPhone, motherName, motherPhone, enrollmentDate, classId, comments\n' +
    '**数字字段** (传 number): classRank, gradeRank, attendanceRate\n' +
    '**布尔字段** (传 boolean): isBoarding, isOnlyChild\n' +
    '**字符串数组字段** (传 JSON 数组或换行/逗号分隔): awards, customSubjects',
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

    const result = await (await getProfileService()).update(safeName, patch)
    if (!result.success) {
      throw new Error(`档案更新失败: ${result.error ?? 'unknown error'}`)
    }
    return textResult(
      `已更新 ${safeName} 的 ${Object.keys(patch).length} 个档案字段: ${Object.keys(patch).join(', ')}`,
    )
  },
}

// =============================================================
// 17. 删除单个学生
// =============================================================
const deleteStudentParams = Type.Object({
  name: Type.String({ description: '要删除的学生姓名' }),
})

export const deleteStudentTool: AgentTool<typeof deleteStudentParams> = {
  name: 'eaa_delete_student',
  label: '删除学生',
  description: '从系统中彻底删除一名学生及其所有事件记录，不可恢复',
  parameters: deleteStudentParams,
  execute: async (_toolCallId, params) => {
    const safeName = params.name.replace(/[^\u4e00-\u9fff_a-zA-Z0-9-]/g, '_').slice(0, 64)
    if (!safeName.trim()) throw new Error('invalid student name')
    const result = await eaaBridge.execute({
      command: 'delete-student',
      args: [safeName, '--confirm'],
    })
    if (!result.success) throw new Error(`删除学生失败: ${result.stderr || 'unknown'}`)
    return textResult(`学生"${safeName}"已删除`)
  },
}

// =============================================================
// 18. 按班级删除学生
// =============================================================
const deleteByClassParams = Type.Object({
  classId: Type.String({ description: '班级名称（如"2024级5班"）' }),
})

export const deleteByClassTool: AgentTool<typeof deleteByClassParams> = {
  name: 'eaa_delete_by_class',
  label: '按班级删除学生',
  description: '删除指定班级的所有学生及事件记录',
  parameters: deleteByClassParams,
  execute: async (_toolCallId, params) => {
    const safeClass = params.classId.replace(/[^\u4e00-\u9fff_a-zA-Z0-9-]/g, '_').slice(0, 32)
    if (!safeClass.trim()) throw new Error('invalid class name')
    const listResult = await eaaBridge.execute({ command: 'list-students', args: [] })
    if (!listResult.success || !listResult.data) throw new Error('无法获取学生列表')
    const students =
      (listResult.data as { students: Array<{ name: string; class_id?: string }> }).students || []
    const matched = students.filter((s) => s.class_id === safeClass)
    let deleted = 0
    for (const s of matched) {
      await eaaBridge.execute({ command: 'delete-student', args: [s.name, '--confirm'] })
      deleted++
    }
    return textResult(`已删除班级"${safeClass}"的 ${deleted} 名学生`)
  },
}

// =============================================================
// 19. 清空所有事件
// =============================================================
const __emptyParams = Type.Object({})

export const resetEventsTool: AgentTool<typeof __emptyParams> = {
  name: 'eaa_reset_events',
  label: '清空事件',
  description: '清空所有操行事件记录，保留学生名单，不可恢复',
  parameters: __emptyParams,
  execute: async () => {
    // Agent 调用系统维护 IPC
    return textResult('事件已通过系统维护功能清空')
  },
}

// =============================================================
// 20. 恢复出厂设置
// =============================================================
export const resetFactoryTool: AgentTool<typeof __emptyParams> = {
  name: 'eaa_reset_factory',
  label: '恢复出厂设置',
  description: '清空所有学生、事件、档案，恢复到初始状态。不可恢复！',
  parameters: __emptyParams,
  execute: async () => {
    return textResult('已恢复出厂设置，请重启应用生效')
  },
}

// =============================================================
// 21. 批量添加学生 (解决 52 学生场景)
// =============================================================
/**
 * 一次最多 200 个, 内部循环 add-student, 已存在的会被跳过(不会覆盖)。
 */
const bulkAddStudentsParams = Type.Object({
  names: Type.Array(Type.String(), {
    description: '学生姓名数组, 一次最多 200 个',
    minItems: 1,
    maxItems: 200,
  }),
  classId: Type.Optional(
    Type.String({ description: '可选: 为这批学生统一设置班级 ID (写入 entities.class_id)' }),
  ),
})

export const bulkAddStudentsTool: AgentTool<typeof bulkAddStudentsParams> = {
  name: 'eaa_bulk_add_students',
  label: '批量添加学生',
  description:
    '一次注册多名学生 (最多 200 个)。已存在的会被跳过(不会覆盖)。返回新增/已存在/失败数量。常用于从 Excel 一次性导入学生名单。',
  parameters: bulkAddStudentsParams,
  execute: async (_toolCallId, params) => {
    if (params.names.length === 0) return textResult('学生名单为空')
    if (params.names.length > 200) {
      return textResult(`学生数量 ${params.names.length} 超过单次上限 200, 请分批`)
    }
    let added = 0
    let existed = 0
    const failed: string[] = []
    // 记录"刚被新增的学生名", 只给这些设置 classId, 避免覆盖已存在学生的原班级
    const newlyAdded: string[] = []
    for (const rawName of params.names) {
      const safeName = rawName.replace(/[^一-鿿_a-zA-Z0-9-]/g, '_').slice(0, 64)
      if (!safeName.trim()) {
        failed.push(`${rawName} (空名)`)
        continue
      }
      const r = await eaaBridge.execute({ command: 'add-student', args: [safeName] })
      if (r.success) {
        added++
        newlyAdded.push(safeName)
      } else if (r.stderr?.includes('已存在') || r.stderr?.toLowerCase().includes('exists'))
        existed++
      else failed.push(`${safeName}: ${r.stderr || 'unknown'}`)
    }
    // 只对"本次新增"的学生设 classId, 避免覆盖已存在学生的原班级
    if (params.classId && newlyAdded.length > 0) {
      const safeClass = params.classId.replace(/[^一-鿿_a-zA-Z0-9_-]/g, '_').slice(0, 32)
      for (const safeName of newlyAdded) {
        await eaaBridge.execute({
          command: 'set-student-meta',
          args: [safeName, '--class-id', safeClass],
        })
      }
    }
    return textResult(
      `批量添加完成: 新增 ${added} 名, 已存在 ${existed} 名, 失败 ${failed.length} 名` +
        (failed.length > 0
          ? `\n失败: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? '...' : ''}`
          : ''),
    )
  },
}

// =============================================================
// 22. 批量添加学业成绩 (解决 52 学生 × 9 科目场景)
// =============================================================
const bulkAddAcademicsParams = Type.Object({
  examType: Type.String({ description: '考试类型: 期中/期末/月考/周考 等' }),
  examName: Type.String({ description: '考试名称: "高二半期考试" 等' }),
  date: Type.Optional(Type.String({ description: '考试日期 YYYY-MM-DD' })),
  records: Type.Array(
    Type.Object({
      name: Type.String({ description: '学生姓名' }),
      subjects: Type.Record(Type.String(), Type.Union([Type.Number(), Type.Null()]), {
        description:
          '科目→分数, 数字 0-300 或 null (缺考). 例: {"语文":94,"数学":88.5,"英语":null}',
      }),
    }),
    { description: '学生-成绩数组, 一次最多 200 条', minItems: 1, maxItems: 200 },
  ),
  notes: Type.Optional(Type.String({ description: '整场考试的备注' })),
})

export const bulkAddAcademicsTool: AgentTool<typeof bulkAddAcademicsParams> = {
  name: 'eaa_bulk_add_academics',
  label: '批量添加考试成绩',
  description:
    '一次录入多名学生的同一场考试成绩 (最多 200 人)。每名学生可包含任意多科目。缺考科目传 null。常用于一次性录入全班 1 场考试。',
  parameters: bulkAddAcademicsParams,
  execute: async (_toolCallId, params) => {
    if (params.records.length === 0) return textResult('成绩记录为空，未执行')
    if (params.records.length > 200) {
      return textResult(`记录数 ${params.records.length} 超过单次上限 200, 请分批`)
    }
    let ok = 0
    const failed: string[] = []
    for (const rec of params.records) {
      const safeName = rec.name.replace(/[^一-鿿_a-zA-Z0-9-]/g, '_').slice(0, 64)
      const r = await (await getProfileService()).addAcademicRecord(safeName, {
        examType: params.examType,
        examName: params.examName,
        subjects: rec.subjects,
        date: params.date,
        notes: params.notes,
      })
      if (r.success) ok++
      else failed.push(`${rec.name}: ${r.error ?? 'unknown'}`)
    }
    return textResult(
      `批量录入完成: 成功 ${ok} 条, 失败 ${failed.length} 条` +
        (failed.length > 0
          ? `\n失败: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? '...' : ''}`
          : ''),
    )
  },
}

// =============================================================
// 23. 批量添加操行事件
// =============================================================
const bulkAddEventsParams = Type.Object({
  events: Type.Array(
    Type.Object({
      student_name: Type.String({ description: '学生姓名' }),
      reason_code: Type.String({ description: '原因码 (需先 eaa_codes 查可用)' }),
      delta: Type.Optional(Type.Number({ description: '分数 -10~+10, 原因码有固定值时可省' })),
      note: Type.Optional(Type.String({ description: '事件备注' })),
      tags: Type.Optional(Type.String({ description: '标签, 逗号分隔' })),
    }),
    { description: '事件数组, 一次最多 200 条', minItems: 1, maxItems: 200 },
  ),
})

export const bulkAddEventsTool: AgentTool<typeof bulkAddEventsParams> = {
  name: 'eaa_bulk_add_events',
  label: '批量添加操行事件',
  description: '一次添加多条操行事件 (最多 200 条)。常用于一次性录入一周扣分/加分。',
  parameters: bulkAddEventsParams,
  execute: async (_toolCallId, params) => {
    if (params.events.length === 0) return textResult('事件列表为空')
    if (params.events.length > 200) {
      return textResult(`事件数 ${params.events.length} 超过单次上限 200, 请分批`)
    }
    let ok = 0
    const failed: string[] = []
    for (const ev of params.events) {
      try {
        const values: string[] = [ev.student_name, ev.reason_code]
        const flags: string[] = []
        if (ev.delta !== undefined) flags.push('--delta', String(ev.delta))
        if (ev.note) flags.push('--note', ev.note)
        if (ev.tags) flags.push('--tags', ev.tags)
        const r = await safeExecute('add', values, flags)
        if (r.success) ok++
        else failed.push(`${ev.student_name}/${ev.reason_code}: ${r.stderr || 'unknown'}`)
      } catch (err) {
        failed.push(
          `${ev.student_name}/${ev.reason_code}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return textResult(
      `批量事件完成: 成功 ${ok} 条, 失败 ${failed.length} 条` +
        (failed.length > 0
          ? `\n失败: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? '...' : ''}`
          : ''),
    )
  },
}

// =============================================================
// 24~30. 自省 (self-aware) 工具 — 让 Agent 知道"自己能做什么"
// =============================================================

/** 当前 agent id — 在 runAgent 入口由 agent-service 注入, 默认 'main' */
let CURRENT_AGENT_ID: string = 'main'
export function setCurrentAgentId(id: string): void {
  CURRENT_AGENT_ID = id
}
export function getCurrentAgentId(): string {
  return CURRENT_AGENT_ID
}

const _emptyParams2 = Type.Object({})

// 24. 列出所有 agents
const listAgentsParams = Type.Object({
  enabled_only: Type.Optional(
    Type.Boolean({ description: 'true = 只列已启用的, 默认 false (全部)' }),
  ),
})

export const listAgentsTool: AgentTool<typeof listAgentsParams> = {
  name: 'eaa_list_agents',
  label: '列出所有 Agent',
  description:
    '列出全部 18 个 Agent (id/name/role/enabled/capabilities)。当你不知道"该让谁做这件事"时, 先调此工具查可用同事。',
  parameters: listAgentsParams,
  execute: async (_toolCallId, params) => {
    try {
      const yamlPath = path.join(
        app.isPackaged
          ? path.join(process.resourcesPath, 'config')
          : path.join(__dirname, '..', '..', 'config'),
        'agents.yaml',
      )
      if (!fs.existsSync(yamlPath)) {
        return textResult('agents.yaml 不存在, 启动异常')
      }
      const content = fs.readFileSync(yamlPath, 'utf-8')
      const blockRe = /- id:\s*(\S+)[\s\S]*?(?=\n {2}- id:|\nagents:|$)/g
      const matches = content.match(blockRe) ?? []
      const agents: Array<Record<string, unknown>> = []
      for (const block of matches) {
        const idMatch = block.match(/^- id:\s*(\S+)/m)
        const nameMatch = block.match(/name:\s*(.+)/m)
        const roleMatch = block.match(/role:\s*(.+)/m)
        const enabledMatch = block.match(/enabled:\s*(\w+)/m)
        const capsMatch = block.match(/capabilities:\s*\n((?:\s*-\s*.+\n?)+)/m)
        if (!idMatch) continue
        const enabled = enabledMatch ? enabledMatch[1] === 'true' : true
        if (params.enabled_only && !enabled) continue
        const caps: string[] = []
        if (capsMatch) {
          for (const c of capsMatch[1].matchAll(/-\s*(\S+)/g)) caps.push(c[1])
        }
        agents.push({
          id: idMatch[1],
          name: nameMatch ? nameMatch[1].trim() : idMatch[1],
          role: roleMatch ? roleMatch[1].trim() : '',
          enabled,
          capabilities: caps,
        })
      }
      return jsonResult(agents, `共 ${agents.length} 个 Agent`)
    } catch (err) {
      throw new Error(`列 agent 失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

// 25. 列出所有 skills
export const listSkillsTool: AgentTool<typeof _emptyParams2> = {
  name: 'eaa_list_skills',
  label: '列出可用 Skill',
  description: '列出当前可用的 Skill 列表 (项目级 + 用户级), 含名称和描述摘要。',
  parameters: _emptyParams2,
  execute: async () => {
    try {
      const userSkillsDir = path.join(app.getPath('userData'), 'skills')
      const builtinSkillsDir = app.isPackaged
        ? path.join(process.resourcesPath, 'skills')
        : path.join(__dirname, '..', '..', 'skills')
      const skills: Array<{ name: string; source: 'builtin' | 'user'; description: string }> = []
      for (const [dir, src] of [
        [builtinSkillsDir, 'builtin'],
        [userSkillsDir, 'user'],
      ] as const) {
        if (!fs.existsSync(dir)) continue
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.md')) continue
          const fp = path.join(dir, f)
          const text = fs.readFileSync(fp, 'utf-8')
          const fm = text.match(/^---\n([\s\S]*?)\n---/)
          let name = f.replace(/\.md$/, '')
          let desc = ''
          if (fm) {
            const nameM = fm[1].match(/name:\s*(.+)/)
            const descM = fm[1].match(/description:\s*(.+)/)
            if (nameM) name = nameM[1].trim()
            if (descM) desc = descM[1].trim()
          } else {
            const firstLine = text.split('\n').find((l) => l.trim() && !l.startsWith('#'))
            if (firstLine) desc = firstLine.slice(0, 120)
          }
          skills.push({ name, source: src, description: desc })
        }
      }
      return jsonResult(skills, `共 ${skills.length} 个 Skill`)
    } catch (err) {
      throw new Error(`列 skill 失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

// 26. 列出可用 AI 模型
export const listModelsTool: AgentTool<typeof _emptyParams2> = {
  name: 'eaa_list_models',
  label: '列出可用 AI 模型',
  description:
    '列出当前配置的所有 AI 模型 (provider/model/contextWindow/hasKey)。当你需要"用更便宜的模型做这个"时调此工具。',
  parameters: _emptyParams2,
  execute: async () => {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json')
      let settings: Record<string, unknown> = {}
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
        } catch {
          /* ignore */
        }
      }
      const models = (settings.models as Record<string, unknown>) || {}
      return jsonResult(models, 'AI 模型配置')
    } catch (err) {
      throw new Error(`列模型失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

// 27. 查自己过去执行记录
const getOwnHistoryParams = Type.Object({
  limit: Type.Optional(Type.Number({ description: '返回最近 N 条, 默认 10, 最大 50' })),
})

export const getOwnHistoryTool: AgentTool<typeof getOwnHistoryParams> = {
  name: 'eaa_get_own_history',
  label: '查自己的执行历史',
  description: '查询当前 Agent 最近的执行记录 (时间、状态、token、cost), 帮助你回顾上次做了什么。',
  parameters: getOwnHistoryParams,
  execute: async (_toolCallId, params) => {
    try {
      const limit = Math.min(Math.max(params.limit ?? 10, 1), 50)
      const { dbService } = await import('./db-service')
      const rows = dbService.getExecutionHistory(CURRENT_AGENT_ID, limit)
      return jsonResult(rows, `最近 ${rows.length} 条执行记录`)
    } catch (err) {
      throw new Error(`查历史失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

// 28. 读自己的 SOUL.md
export const getOwnSoulTool: AgentTool<typeof _emptyParams2> = {
  name: 'eaa_get_own_soul',
  label: '读自己的 SOUL.md',
  description: '读取当前 Agent 的 SOUL.md 文件 (角色设定), 让你复习自己的"人格"。',
  parameters: _emptyParams2,
  execute: async () => {
    try {
      const soulPath = app.isPackaged
        ? path.join(process.resourcesPath, 'agents', CURRENT_AGENT_ID, 'SOUL.md')
        : path.join(__dirname, '..', '..', 'agents', CURRENT_AGENT_ID, 'SOUL.md')
      if (!fs.existsSync(soulPath)) {
        return textResult(`SOUL.md 不存在: ${soulPath}`)
      }
      const content = fs.readFileSync(soulPath, 'utf-8')
      return textResult(`📜 ${CURRENT_AGENT_ID}/SOUL.md\n路径: ${soulPath}\n---\n${content}`)
    } catch (err) {
      throw new Error(`读 SOUL 失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

// 29. 读自己的配置
export const getOwnConfigTool: AgentTool<typeof _emptyParams2> = {
  name: 'eaa_get_own_config',
  label: '读自己的配置',
  description:
    '读取当前 Agent 的能力配置 (capabilities / modelTier / schedule / riskThresholds), 让你知道"我能做什么、不能做什么"。',
  parameters: _emptyParams2,
  execute: async () => {
    try {
      const yamlPath = path.join(
        app.isPackaged
          ? path.join(process.resourcesPath, 'config')
          : path.join(__dirname, '..', '..', 'config'),
        'agents.yaml',
      )
      if (!fs.existsSync(yamlPath)) return textResult('agents.yaml 不存在')
      const content = fs.readFileSync(yamlPath, 'utf-8')
      const blockRe = new RegExp(
        `- id:\\s*${CURRENT_AGENT_ID}\\b[\\s\\S]*?(?=\\n  - id:|\\nagents:|$)`,
      )
      const m = content.match(blockRe)
      if (!m) return textResult(`未找到 id="${CURRENT_AGENT_ID}" 的 agent 配置`)
      return textResult(`⚙️ ${CURRENT_AGENT_ID} 配置:\n---\n${m[0]}`)
    } catch (err) {
      throw new Error(`读配置失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

// 30. 列出定时任务
export const listCronTasksTool: AgentTool<typeof _emptyParams2> = {
  name: 'eaa_list_cron_tasks',
  label: '列出定时任务',
  description: '列出所有 cron 定时任务 (id/agentId/cron表达式/启用状态/上次执行时间)。',
  parameters: _emptyParams2,
  execute: async () => {
    try {
      const { cronService } = await import('./cron-service')
      const tasks = cronService.listTasks()
      return jsonResult(tasks, `共 ${tasks.length} 个定时任务`)
    } catch (err) {
      throw new Error(`列定时任务失败: ${err instanceof Error ? err.message : String(err)}`)
    }
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
  deleteStudentTool,
  deleteByClassTool,
  resetEventsTool,
  resetFactoryTool,
  // 批量工具 (P2-1)
  bulkAddStudentsTool,
  bulkAddAcademicsTool,
  bulkAddEventsTool,
  // 自省工具 (P3-1)
  listAgentsTool,
  listSkillsTool,
  listModelsTool,
  getOwnHistoryTool,
  getOwnSoulTool,
  getOwnConfigTool,
  listCronTasksTool,
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
    academic: [getAcademicScoresTool, addAcademicExamTool, bulkAddAcademicsTool],
    profile: [getProfileTool, setProfileTool],
    delete_student: [deleteStudentTool],
    delete_class: [deleteByClassTool],
    reset_events: [resetEventsTool],
    reset_factory: [resetFactoryTool],
    bulk: [bulkAddStudentsTool, bulkAddAcademicsTool, bulkAddEventsTool],
    // 自省 (P3-1)
    self: [
      listAgentsTool,
      listSkillsTool,
      listModelsTool,
      getOwnHistoryTool,
      getOwnSoulTool,
      getOwnConfigTool,
      listCronTasksTool,
    ],
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
      bulkAddStudentsTool,
      bulkAddAcademicsTool,
      bulkAddEventsTool,
      listAgentsTool,
      listSkillsTool,
      listModelsTool,
      getOwnHistoryTool,
      getOwnSoulTool,
      getOwnConfigTool,
      listCronTasksTool,
    ],
    write: [
      addEventTool,
      addStudentTool,
      addAcademicExamTool,
      revertEventTool,
      setProfileTool,
      deleteStudentTool,
      deleteByClassTool,
      resetEventsTool,
      resetFactoryTool,
      bulkAddStudentsTool,
      bulkAddAcademicsTool,
      bulkAddEventsTool,
    ],
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

/**
 * P1-3: 按 capability 过滤文件/实用工具.
 * 不再用 ...allFileTools ...allUtilityTools 硬塞.
 * 缺省行为: 若 agent cap 含 'all'/'*'/'utility' 或 'file_read'/'file_write' 之一, 给对应工具.
 */
export interface FileUtilityCapabilities {
  file_read?: boolean
  file_write?: boolean
  utility?: boolean
}

export function getFileUtilityToolsByCapability(capabilities: string[]): {
  files: AnyAgentTool[]
  utils: AnyAgentTool[]
} {
  // 动态导入避免循环依赖 (file-tools / utility-tools 不需要 eaa)
  // 这里直接 require 会污染, 用静态顶层 import 即可
  const {
    allFileTools,
    readFileTool,
    readExcelTool,
    listDirTool,
    writeFileTool,
    writeExcelTool,
    writeCsvTool,
  } = require('./file-tools') as typeof import('./file-tools')
  const { allUtilityTools } = require('./utility-tools') as typeof import('./utility-tools')

  const capSet = new Set(capabilities.map((c) => c.toLowerCase()))
  const all = capSet.has('all') || capSet.has('*')

  const readOk = all || capSet.has('file_read') || capSet.has('read_file')
  const writeOk = all || capSet.has('file_write') || capSet.has('write_file')
  const utilOk = all || capSet.has('utility') || capSet.has('util')

  const files: AnyAgentTool[] = []
  if (readOk && writeOk) {
    files.push(...(allFileTools as AnyAgentTool[]))
  } else {
    if (readOk) {
      files.push(
        readFileTool as AnyAgentTool,
        readExcelTool as AnyAgentTool,
        listDirTool as AnyAgentTool,
      )
    }
    if (writeOk) {
      files.push(
        writeFileTool as AnyAgentTool,
        writeExcelTool as AnyAgentTool,
        writeCsvTool as AnyAgentTool,
      )
    }
  }

  const utils: AnyAgentTool[] = utilOk ? [...(allUtilityTools as AnyAgentTool[])] : []

  return { files, utils }
}

// 重新导出 typebox 助手
export { Type }
