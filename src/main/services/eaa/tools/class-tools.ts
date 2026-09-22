// =============================================================
// EAA Tools — 班级管理（list / create）+ 批量导入花名册
// 班级记录走 class-service（SQLite）；学生写入仍走 EAA CLI。
// 补上此前 Agent 只能加学生、不能建班的缺口。
// =============================================================

import type { AgentTool } from '@main/services/llm-contracts'
import { computeAutoClassId, inferClassFromLabel } from '@shared/class-id'
import type { RosterProfilePatch } from '@shared/roster-profile'
import { fieldsToProfilePatch } from '@shared/roster-profile'
import { Type } from 'typebox'
import {
  buildClassIndex,
  parseStudentImportSheets,
  readExcelSheets,
  validateExcelFilePath,
} from '../../../ipc/students/excel-import'
import { sanitizeClassId, sanitizeName } from '../../../utils/sanitize'
import { invalidateClassContextCache } from '../../agent/class-context'
import { classService } from '../../class-service'
import { eaaBridge } from '../../eaa-bridge'
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
    description:
      '班级显示名称，必须带年级，如 高三5班 / 高一4班。不要只写「5班」，否则会生成错误年级编号。',
  }),
  grade: Type.Optional(
    Type.String({ description: '年级，如 高三 / 高一 / 七年级。不填则从 name 推断' }),
  ),
  teacher: Type.Optional(Type.String({ description: '班主任姓名' })),
  class_id: Type.Optional(
    Type.String({
      description:
        '班级编号（字母数字/点/连字符，如 G12-5）。不填则按年级+班号自动生成：高三5班→G12-5，高一4班→G10-4',
    }),
  ),
  note: Type.Optional(Type.String({ description: '备注' })),
})

const updateClassParams = Type.Object({
  class_id: Type.String({ description: '要修改的班级编号，如 G12-5' }),
  name: Type.Optional(Type.String({ description: '新的显示名称' })),
  grade: Type.Optional(Type.String({ description: '年级' })),
  teacher: Type.Optional(
    Type.String({ description: '班主任姓名。教师说「班主任填张三」时用这个' }),
  ),
  note: Type.Optional(Type.String({ description: '备注' })),
})

const archiveClassParams = Type.Object({
  class_id: Type.String({ description: '要存档的班级编号' }),
  confirm: Type.Boolean({
    description: '必须为 true。存档后日常列表隐藏该班，学生数据保留，可再恢复。',
  }),
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
  class_id: Type.String({ description: '目标班级编号（须已存在，如 G12-5）' }),
  excel_path: Type.Optional(
    Type.String({
      description:
        '花名册 Excel 的绝对路径。有文件时必须用这个，不要把姓名从对话或其他班级抄进 students。身份证/电话/住址由主进程写入档案，不要贴进对话。',
    }),
  ),
  sheet: Type.Optional(
    Type.String({
      description: '只导入该工作表。不填则自动合并所有含「姓名」列的工作表（空表跳过）。',
    }),
  ),
  names: Type.Optional(
    Type.Array(Type.String(), {
      description: '仅姓名列表。只用于教师口头报的几个人名。有 Excel 时禁止用这个。',
    }),
  ),
  students: Type.Optional(
    Type.Array(rosterStudentParams, {
      description:
        '带档案字段的学生列表。有文件时禁止用：Excel 解析失败也不准从对话拼名单，应把错误告诉教师。',
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description:
        '只解析花名册、返回将导入的姓名与人数，不写入。excel_path 不确定时先用这个核对。',
    }),
  ),
  replace_class: Type.Optional(
    Type.Boolean({
      description:
        'true=本文件视为该班完整花名册。导入后，该班里不在本次名单中的学生会被移出该班（不删除学生、不删操行记录）。纠正错导名单时必须为 true。',
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

function requireClass(classId: string) {
  const cls = classService.list().find((c) => c.class_id === classId)
  if (!cls) throw new Error(`班级编号 "${classId}" 不存在。请先用 eaa_list_classes 核对。`)
  return cls
}

export const updateClassTool: AgentTool<typeof updateClassParams> = {
  name: 'eaa_update_class',
  label: '修改班级',
  description:
    '修改已有班级的显示名/年级/班主任/备注。教师说「G12-5 班主任改成张老师」时调用。不改学生名单。',
  parameters: updateClassParams,
  execute: async (_toolCallId, params) => {
    const classId = sanitizeClassId(params.class_id)
    const cls = requireClass(classId)
    const result = classService.update(cls.id, {
      name: params.name,
      grade: params.grade,
      teacher: params.teacher,
      note: params.note,
    })
    if (!result.success) throw new Error(result.error || '修改班级失败')
    invalidateClassContextCache()
    const updated = requireClass(classId)
    return jsonResult(
      {
        class_id: updated.class_id,
        name: updated.name,
        grade: updated.grade ?? '',
        teacher: updated.teacher ?? '',
      },
      `班级已更新: ${updated.name} (${updated.class_id})`,
    )
  },
}

export const archiveClassTool: AgentTool<typeof archiveClassParams> = {
  name: 'eaa_archive_class',
  label: '存档班级',
  description:
    '把班级标记为存档（日常列表隐藏，学生与事件保留）。用于错误班级或已毕业班。必须 confirm:true。',
  parameters: archiveClassParams,
  execute: async (_toolCallId, params) => {
    if (!params.confirm) {
      throw new Error('存档班级需要 confirm: true')
    }
    const classId = sanitizeClassId(params.class_id)
    const cls = requireClass(classId)
    const result = classService.archive(cls.id)
    if (!result.success) throw new Error(result.error || '存档失败')
    invalidateClassContextCache()
    return jsonResult({ class_id: classId, archived: true }, `班级已存档: ${cls.name} (${classId})`)
  },
}

interface RosterImportItem {
  name: string
  patch: RosterProfilePatch
}

interface ListedStudent {
  name: string
  status?: string
  class_id?: string | null
}

async function listActiveStudents(): Promise<ListedStudent[]> {
  const result = await eaaBridge.execute({ command: 'list-students', args: [] })
  if (!result?.success) return []
  const students = (result.data as { students?: ListedStudent[] } | null)?.students ?? []
  return students.filter((s) => s.status !== 'Deleted')
}

async function collectExistingNames(): Promise<Set<string>> {
  return new Set((await listActiveStudents()).map((s) => s.name))
}

function resolveRosterItems(
  params: {
    excel_path?: string
    sheet?: string
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
): {
  items: RosterImportItem[]
  parseErrors: Array<{ name: string; error: string }>
  sheetsUsed: string[]
  source: 'excel_path' | 'students' | 'names'
} {
  const parseErrors: Array<{ name: string; error: string }> = []
  if (params.excel_path) {
    const validated = validateExcelFilePath(params.excel_path)
    if (!validated.ok) throw new Error(validated.error)
    const sheets = readExcelSheets(params.excel_path)
    const filtered = params.sheet ? sheets.filter((s) => s.name === params.sheet) : sheets
    if (params.sheet && filtered.length === 0) {
      throw new Error(
        `工作表「${params.sheet}」不存在。可用工作表: ${sheets.map((s) => s.name).join(', ')}`,
      )
    }
    const preview = parseStudentImportSheets(
      filtered,
      existingNames,
      buildClassIndex(classService.list()),
      { fallbackClassId: classId },
    )
    if (!preview.success) throw new Error(preview.error || '无法解析花名册')
    for (const err of preview.errors) {
      parseErrors.push({ name: err.name || `(第${err.row}行)`, error: err.reason })
    }
    return {
      source: 'excel_path',
      sheetsUsed: preview.sheets_used,
      items: preview.rows.map((r) => ({
        name: r.name,
        patch: fieldsToProfilePatch({
          studentId: r.studentId,
          examNumber: r.examNumber,
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
      source: 'students',
      sheetsUsed: [],
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
      source: 'names',
      sheetsUsed: [],
      items: params.names.map((n) => ({ name: String(n ?? ''), patch: { classId } })),
      parseErrors,
    }
  }
  throw new Error(
    '请提供 excel_path（有花名册文件时必须用这个）。禁止从对话或其他班级抄名单填 students/names。',
  )
}

export const importStudentsTool: AgentTool<typeof importStudentsParams> = {
  name: 'eaa_import_students',
  label: '批量导入学生',
  description:
    '把花名册导入指定班级，并把身份证/电话/住址写入学生档案。' +
    '有 Excel 时必须传 excel_path（自动跳过标题行、识别「姓名/学生姓名/就读班级/学号/考号」等列，合并有数据的工作表）。' +
    '解析失败时把错误告诉教师，禁止改用 students[] 从对话或其他班抄名单。' +
    '已存在的同名学生会更新档案并分入该班。' +
    '纠正错导名单时加 replace_class:true。' +
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
    const { items, parseErrors, sheetsUsed, source } = resolveRosterItems(
      params,
      classId,
      existingNames,
    )
    if (items.length === 0) {
      const errHint = parseErrors
        .slice(0, 8)
        .map((e) => `${e.name}: ${e.error}`)
        .join('；')
      throw new Error(
        `没有可导入的学生行。${errHint || '请检查表头是否含「姓名」'}。禁止改用 students[] 从对话抄名单。`,
      )
    }
    if (items.length > MAX_IMPORT_NAMES) {
      throw new Error(`单次最多导入 ${MAX_IMPORT_NAMES} 人，本次 ${items.length} 人`)
    }

    const previewNames = items.map((it) => String(it.name ?? '').trim()).filter(Boolean)
    if (params.dry_run) {
      return jsonResult(
        {
          dry_run: true,
          class_id: classId,
          source,
          sheets_used: sheetsUsed,
          count: previewNames.length,
          names: previewNames,
          parse_errors: parseErrors,
          note: '未写入。核对姓名后去掉 dry_run 再导入。名单必须来自本文件，不要换成其他班的人。',
        },
        `预览 ${previewNames.length} 人，未写入`,
      )
    }

    const sourceWarning =
      source !== 'excel_path' && items.length >= 15
        ? '未使用 excel_path，一次传入大量姓名很容易抄错班。若教师刚上传了 Excel，请改用 excel_path 重新导入。'
        : undefined

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

    const unassigned: string[] = []
    if (params.replace_class) {
      const keep = new Set([...imported, ...assignedExisting])
      const current = await listActiveStudents()
      for (const s of current) {
        if (s.class_id !== classId) continue
        if (keep.has(s.name)) continue
        const cleared = await eaaBridge.execute({
          command: 'set-student-meta',
          args: [s.name, '--clear-class-id'],
        })
        if (cleared.success) unassigned.push(s.name)
        else {
          failed.push({
            name: s.name,
            error: `移出班级失败: ${cleared.stderr || '未知错误'}`,
          })
        }
      }
    }

    invalidateClassContextCache()
    return jsonResult(
      {
        class_id: classId,
        source,
        sheets_used: sheetsUsed,
        requested: items.length,
        imported: imported.length,
        assigned_existing: assignedExisting.length,
        profiles_written: profilesWritten,
        id_cards_stored: idCardsStored,
        skipped_duplicates: skippedDuplicates,
        unassigned_from_class: unassigned,
        failed,
        imported_names: imported,
        assigned_existing_names: assignedExisting,
        names_in_class: [...imported, ...assignedExisting],
        warning: sourceWarning,
        note: '身份证/电话/住址已写入学生档案（非操行事件）。回复中不要复述完整身份证号。请用 eaa_list_students({ class_id }) 核对本班名单是否与文件一致。',
      },
      `导入完成: 新增 ${imported.length} 人，已存在并更新档案 ${assignedExisting.length} 人，档案写入 ${profilesWritten} 人（含身份证 ${idCardsStored} 人），失败 ${failed.length} 人` +
        (skippedDuplicates.length ? `，名单内重名跳过 ${skippedDuplicates.length} 人` : '') +
        (unassigned.length ? `，移出该班 ${unassigned.length} 人` : ''),
    )
  },
}
