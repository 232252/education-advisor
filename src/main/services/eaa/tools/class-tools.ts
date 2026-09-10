// =============================================================
// EAA Tools — 班级管理（list / create）+ 批量导入花名册
// 班级记录走 class-service（SQLite）；学生写入仍走 EAA CLI。
// 补上此前 Agent 只能加学生、不能建班的缺口。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { computeAutoClassId, inferClassFromLabel } from '@shared/class-id'
import { fieldsToProfilePatch } from '@shared/roster-profile'
import type { RosterProfilePatch } from '@shared/roster-profile'
import { sanitizeClassId, sanitizeName } from '../../../utils/sanitize'
import { invalidateClassContextCache } from '../../agent/class-context'
import { classService } from '../../class-service'
import { eaaBridge } from '../../eaa-bridge'
import {
  buildClassIndex,
  parseStudentImportMatrix,
  readExcelMatrix,
  validateExcelFilePath,
} from '../../../ipc/students/excel-import'
import {
  applyStudentRosterProfile,
  isAlreadyExistsError,
  registerRosterPrivacy,
} from '../../profile-import'
import { jsonResult, textResult } from './shared'

const MAX_IMPORT_NAMES = 200

const listClassesParams = Type.Object({})

const createClassParams = Type.Object({
  name: Type.String({
    description: '班级显示名称，如 高一4班。可从花名册标题原样填入',
  }),
  grade: Type.Optional(Type.String({ description: '年级，如 高一 / 七年级。不填则从 name 推断' })),
  teacher: Type.Optional(Type.String({ description: '班主任姓名' })),
  class_id: Type.Optional(
    Type.String({
      description:
        '班级编号（字母数字/点/连字符，如 G10-4）。不填则按年级+班号自动生成：高一4班→G10-4，七年级3班→G7-3',
    }),
  ),
  note: Type.Optional(Type.String({ description: '备注' })),
})

const rosterStudentParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  id_card: Type.Optional(Type.String({ description: '身份证号（写入学生档案）' })),
  phone: Type.Optional(Type.String({ description: '电话' })),
  address: Type.Optional(Type.String({ description: '家庭住址' })),
  gender: Type.Optional(Type.String({ description: '性别；有身份证时由系统识别' })),
  student_number: Type.Optional(Type.String({ description: '学号' })),
  email: Type.Optional(Type.String({ description: '邮箱' })),
  father_name: Type.Optional(Type.String()),
  father_phone: Type.Optional(Type.String()),
  mother_name: Type.Optional(Type.String()),
  mother_phone: Type.Optional(Type.String()),
})

const importStudentsParams = Type.Object({
  class_id: Type.String({ description: '目标班级编号（须已存在，如 G10-4）' }),
  excel_path: Type.Optional(
    Type.String({
      description:
        '花名册 Excel 的绝对路径。身份证/电话/住址在主进程写入学生档案并由隐私引擎登记，不要把这些字段贴进对话。有花名册文件时优先用这个。',
    }),
  ),
  names: Type.Optional(
    Type.Array(Type.String(), {
      description: '仅姓名列表。有花名册文件时请改用 excel_path。',
    }),
  ),
  students: Type.Optional(
    Type.Array(rosterStudentParams, {
      description: '带档案字段的学生列表。有文件时请用 excel_path，避免身份证进入模型上下文。',
    }),
  ),
})

export const listClassesTool: AgentTool<typeof listClassesParams> = {
  name: 'eaa_list_classes',
  label: '列出班级',
  description:
    '列出系统中已创建的班级（编号/显示名/年级/班主任/是否存档）。导入花名册前先调这个，确认目标班是否存在。',
  parameters: listClassesParams,
  execute: async () => {
    const classes = classService.list().map((c) => ({
      class_id: c.class_id,
      name: c.name,
      grade: c.grade ?? '',
      teacher: c.teacher ?? '',
      archived: c.archived,
    }))
    return jsonResult({ total: classes.length, classes }, `共 ${classes.length} 个班级`)
  },
}

export const createClassTool: AgentTool<typeof createClassParams> = {
  name: 'eaa_create_class',
  label: '创建班级',
  description:
    '在系统中新建一个班级。学生必须归属于班级；导入花名册前若目标班不存在，必须先调用本工具。' +
    'class_id 不填时自动生成（高一4班→G10-4）。同名未存档班级已存在则直接返回已有班级，不重复创建。',
  parameters: createClassParams,
  execute: async (_toolCallId, params) => {
    const name = params.name.trim()
    if (!name) throw new Error('班级名称不能为空')

    const inferred = inferClassFromLabel(name)
    const grade = (params.grade?.trim() || inferred?.grade || '').trim()
    let classId = (params.class_id?.trim() || '').trim()
    if (!classId) {
      classId =
        computeAutoClassId(grade, name) ||
        inferred?.class_id ||
        computeAutoClassId(grade, '1班') ||
        ''
    }
    if (!classId) {
      throw new Error(
        `无法从「${name}」自动生成班级编号。请显式传入 class_id（仅字母数字/点/连字符，如 G10-4）`,
      )
    }
    classId = sanitizeClassId(classId)

    const existing = classService
      .list()
      .find((c) => !c.archived && (c.class_id === classId || c.name === name))
    if (existing) {
      return jsonResult(
        {
          created: false,
          already_exists: true,
          class_id: existing.class_id,
          name: existing.name,
          grade: existing.grade ?? '',
          teacher: existing.teacher ?? '',
        },
        `班级已存在: ${existing.name} (${existing.class_id})，未重复创建`,
      )
    }

    const result = classService.create({
      class_id: classId,
      name,
      grade: grade || undefined,
      teacher: params.teacher?.trim() || undefined,
      note: params.note?.trim() || undefined,
    })
    if (!result.success || !result.data) {
      throw new Error(result.error || '创建班级失败')
    }
    invalidateClassContextCache()
    const c = result.data
    return jsonResult(
      {
        created: true,
        class_id: c.class_id,
        name: c.name,
        grade: c.grade ?? '',
        teacher: c.teacher ?? '',
      },
      `班级已创建: ${c.name} (${c.class_id})`,
    )
  },
}

interface RosterImportItem {
  name: string
  patch: RosterProfilePatch
}

async function collectExistingNames(): Promise<Set<string>> {
  const result = await eaaBridge.execute({ command: 'list-students', args: [] })
  if (!result?.success) return new Set()
  const students = (result.data as { students?: Array<{ name: string; status?: string }> } | null)
    ?.students
  return new Set((students ?? []).filter((s) => s.status !== 'Deleted').map((s) => s.name))
}

function resolveRosterItems(
  params: {
    excel_path?: string
    names?: string[]
    students?: Array<{
      name: string
      id_card?: string
      phone?: string
      address?: string
      gender?: string
      student_number?: string
      email?: string
      father_name?: string
      father_phone?: string
      mother_name?: string
      mother_phone?: string
    }>
  },
  classId: string,
  existingNames: Set<string>,
): { items: RosterImportItem[]; parseErrors: Array<{ name: string; error: string }> } {
  const parseErrors: Array<{ name: string; error: string }> = []
  if (params.excel_path) {
    const validated = validateExcelFilePath(params.excel_path)
    if (!validated.ok) throw new Error(validated.error)
    const matrix = readExcelMatrix(params.excel_path)
    const preview = parseStudentImportMatrix(matrix, existingNames, buildClassIndex(classService.list()), {
      fallbackClassId: classId,
    })
    if (!preview.success) throw new Error(preview.error || '无法解析花名册')
    for (const err of preview.errors) {
      parseErrors.push({ name: err.name || `(第${err.row}行)`, error: err.reason })
    }
    return {
      items: preview.rows.map((r) => ({
        name: r.name,
        patch: fieldsToProfilePatch({
          studentId: r.studentId,
          classId,
          idCard: r.idCard,
          gender: r.gender,
          birthDate: r.birthDate,
          phone: r.phone,
          address: r.address,
          email: r.email,
          fatherName: r.fatherName,
          fatherPhone: r.fatherPhone,
          motherName: r.motherName,
          motherPhone: r.motherPhone,
          enrollmentDate: r.enrollmentDate,
          dormNumber: r.dormNumber,
        }),
      })),
      parseErrors,
    }
  }
  if (Array.isArray(params.students) && params.students.length > 0) {
    return {
      items: params.students.map((s) => ({
        name: String(s.name ?? ''),
        patch: fieldsToProfilePatch({
          studentNumber: s.student_number,
          classId,
          idCard: s.id_card,
          gender: s.gender,
          phone: s.phone,
          address: s.address,
          email: s.email,
          fatherName: s.father_name,
          fatherPhone: s.father_phone,
          motherName: s.mother_name,
          motherPhone: s.mother_phone,
        }),
      })),
      parseErrors,
    }
  }
  if (Array.isArray(params.names) && params.names.length > 0) {
    return {
      items: params.names.map((n) => ({ name: String(n ?? ''), patch: { classId } })),
      parseErrors,
    }
  }
  throw new Error('请提供 excel_path、students 或 names 之一')
}

export const importStudentsTool: AgentTool<typeof importStudentsParams> = {
  name: 'eaa_import_students',
  label: '批量导入学生',
  description:
    '把多名学生加入指定班级，并把花名册里的身份证/电话/住址写入学生档案（操行系统仍只存姓名）。' +
    '有 Excel 花名册时传 excel_path（推荐），不要把身份证号贴进对话。' +
    '已存在的同名学生会跳过新增、更新档案并分入该班。' +
    `单次最多 ${MAX_IMPORT_NAMES} 人。`,
  parameters: importStudentsParams,
  execute: async (_toolCallId, params, signal) => {
    if (signal?.aborted) return textResult('已取消')
    const classId = sanitizeClassId(params.class_id)
    const classes = classService.list()
    if (!classes.some((c) => c.class_id === classId)) {
      throw new Error(`班级编号 "${classId}" 不存在。请先用 eaa_create_class 创建班级`)
    }

    const existingNames = await collectExistingNames()
    const { items, parseErrors } = resolveRosterItems(params, classId, existingNames)
    if (items.length === 0) {
      throw new Error('没有可导入的学生行')
    }
    if (items.length > MAX_IMPORT_NAMES) {
      throw new Error(`单次最多导入 ${MAX_IMPORT_NAMES} 人，本次 ${items.length} 人`)
    }

    const imported: string[] = []
    const assignedExisting: string[] = []
    const failed: Array<{ name: string; error: string }> = [...parseErrors]
    const skippedDuplicates: string[] = []
    const seen = new Set<string>()
    const privacyItems: RosterImportItem[] = []
    let profilesWritten = 0
    let idCardsStored = 0

    for (const item of items) {
      if (signal?.aborted) return textResult('已取消')
      let name = ''
      try {
        name = sanitizeName(String(item.name ?? ''), 'name')
      } catch (err) {
        failed.push({
          name: String(item.name ?? ''),
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      if (seen.has(name)) {
        skippedDuplicates.push(name)
        continue
      }
      seen.add(name)

      const addRes = await eaaBridge.execute({ command: 'add-student', args: [name] })
      let added = addRes.success
      if (!addRes.success) {
        if (!isAlreadyExistsError(addRes.stderr || '', addRes.data)) {
          failed.push({ name, error: addRes.stderr || '添加失败' })
          continue
        }
        added = false
      }

      const meta = await eaaBridge.execute({
        command: 'set-student-meta',
        args: [name, '--class-id', classId],
      })
      if (!meta.success) {
        failed.push({
          name,
          error: added
            ? `已添加但分班失败: ${meta.stderr || '未知错误'}`
            : `学生已存在且分班失败: ${meta.stderr || '未知错误'}`,
        })
        continue
      }

      try {
        const { written } = await applyStudentRosterProfile(name, { ...item.patch, classId })
        if (written) {
          profilesWritten += 1
          privacyItems.push({ name, patch: { ...item.patch, classId } })
        }
        if (item.patch.idCard) idCardsStored += 1
      } catch (err) {
        failed.push({
          name,
          error: `已分班但档案写入失败: ${err instanceof Error ? err.message : String(err)}`,
        })
        continue
      }

      if (added) imported.push(name)
      else assignedExisting.push(name)
    }

    try {
      await registerRosterPrivacy(privacyItems)
    } catch {
      /* 档案已写入 */
    }

    invalidateClassContextCache()
    return jsonResult(
      {
        class_id: classId,
        requested: items.length,
        imported: imported.length,
        assigned_existing: assignedExisting.length,
        profiles_written: profilesWritten,
        id_cards_stored: idCardsStored,
        skipped_duplicates: skippedDuplicates,
        failed,
        imported_names: imported,
        assigned_existing_names: assignedExisting,
        note: '身份证/电话/住址已写入学生档案（非操行事件）。回复中不要复述完整身份证号。',
      },
      `导入完成: 新增 ${imported.length} 人，已存在并更新档案 ${assignedExisting.length} 人，档案写入 ${profilesWritten} 人（含身份证 ${idCardsStored} 人），失败 ${failed.length} 人` +
        (skippedDuplicates.length ? `，名单内重名跳过 ${skippedDuplicates.length} 人` : ''),
    )
  },
}
