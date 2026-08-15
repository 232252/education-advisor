// =============================================================
// EAA Tools — 学生管理类工具(add_student / set_student_meta / delete_student)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { getErrorMessage } from '../../eaa-bridge'
import { safeExecute } from './sanitize'
import { nameParam, textResult } from './shared'

// =============================================================
// GAP-1 补全：以下工具让 Agent 覆盖渲染端已有的数据操作能力
// 12. 设置学生属性 (班级/组别/角色) — 对应 eaa:set-student-meta
// 15. 删除学生 — 对应 eaa:delete-student (危险操作,归入独立 delete capability)
// =============================================================

const setStudentMetaParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  classId: Type.Optional(Type.String({ description: '班级 ID（如 7-3）。设置后学生会归属该班级' })),
  clearClassId: Type.Optional(
    Type.Boolean({ description: '设为 true 清除班级归属（优先级高于 classId）' }),
  ),
  group: Type.Optional(Type.String({ description: '组别（如 第1组）' })),
  role: Type.Optional(Type.String({ description: '角色（如 班长、学习委员）' })),
})

const deleteStudentParams = Type.Object({
  name: Type.String({ description: '要删除的学生姓名（危险操作，不可恢复）' }),
  confirm: Type.Boolean({
    description: '必须为 true 才会执行删除。用于防止 Agent 误删',
  }),
})

// =============================================================
// 10. 添加新学生
// =============================================================
export const addStudentTool: AgentTool<typeof nameParam> = {
  name: 'eaa_add_student',
  label: '添加学生',
  description: '在操行系统中注册一名新学生',
  parameters: nameParam,
  execute: async (_toolCallId, params, signal) => {
    const result = await safeExecute('add-student', [params.name], [], signal)
    if (!result.success) {
      throw new Error(`添加学生失败: ${getErrorMessage(result)}`)
    }
    return textResult(`学生已添加: ${params.name}`)
  },
}

// =============================================================
// 12. 设置学生属性 (班级/组别/角色) — 对应 eaa:set-student-meta
// =============================================================
export const setStudentMetaTool: AgentTool<typeof setStudentMetaParams> = {
  name: 'eaa_set_student_meta',
  label: '设置学生属性',
  description: '修改学生属性：班级归属、组别、角色。用于学生分班、调组、任命班干部等场景',
  parameters: setStudentMetaParams,
  execute: async (_toolCallId, params, signal) => {
    const values: string[] = [params.name]
    const flags: string[] = []
    if (params.clearClassId) {
      flags.push('--clear-class-id')
    } else if (params.classId) {
      flags.push('--class-id', params.classId)
    }
    if (params.group) flags.push('--group', params.group)
    if (params.role) flags.push('--role', params.role)
    // 若除姓名外未提供任何字段,视为无操作,避免无意义调用
    if (flags.length === 0) {
      return textResult(`未提供任何待修改属性 (${params.name}),已跳过`)
    }
    const result = await safeExecute('set-student-meta', values, flags, signal)
    if (!result.success) {
      throw new Error(`设置学生属性失败: ${getErrorMessage(result)}`)
    }
    return textResult(`学生属性已更新: ${params.name}`)
  },
}

// =============================================================
// 15. 删除学生 — 对应 eaa:delete-student (危险操作,归入独立 delete capability)
// =============================================================
export const deleteStudentTool: AgentTool<typeof deleteStudentParams> = {
  name: 'eaa_delete_student',
  label: '删除学生',
  description:
    '从操行系统中永久删除一名学生及其所有事件记录。不可恢复！必须将 confirm 设为 true 才会执行',
  parameters: deleteStudentParams,
  execute: async (_toolCallId, params, signal) => {
    if (!params.confirm) {
      throw new Error('删除学生需要显式确认：请将 confirm 参数设为 true')
    }
    const result = await safeExecute('delete-student', [params.name], [], signal)
    if (!result.success) {
      throw new Error(`删除学生失败: ${getErrorMessage(result)}`)
    }
    return textResult(`学生已删除: ${params.name}`)
  },
}
