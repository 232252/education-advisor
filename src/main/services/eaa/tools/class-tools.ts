// =============================================================
// EAA Tools — 班级管理（list / create）+ 批量导入花名册
// 班级记录走 class-service（SQLite）；学生写入仍走 EAA CLI。
// 补上此前 Agent 只能加学生、不能建班的缺口。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { computeAutoClassId, inferClassFromLabel } from '@shared/class-id'
import { sanitizeClassId, sanitizeName } from '../../../utils/sanitize'
import { invalidateClassContextCache } from '../../agent/class-context'
import { classService } from '../../class-service'
import { eaaBridge } from '../../eaa-bridge'
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

const importStudentsParams = Type.Object({
  names: Type.Array(Type.String(), {
    description: '学生姓名列表（只要姓名；不要传身份证号/电话/住址）',
  }),
  class_id: Type.String({ description: '目标班级编号（须已存在，如 G10-4）' }),
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

export const importStudentsTool: AgentTool<typeof importStudentsParams> = {
  name: 'eaa_import_students',
  label: '批量导入学生',
  description:
    '把多名学生一次性加入指定班级（内部逐人 add-student + 设置 class_id）。' +
    '花名册导入请用本工具，不要对每个姓名单独调 50 次 eaa_add_student。' +
    '只传姓名；身份证号/电话/住址系统不接收。已存在的同名学生会跳过新增并尝试分入该班。' +
    `单次最多 ${MAX_IMPORT_NAMES} 人。`,
  parameters: importStudentsParams,
  execute: async (_toolCallId, params, signal) => {
    if (signal?.aborted) return textResult('已取消')
    const classId = sanitizeClassId(params.class_id)
    const classes = classService.list()
    if (!classes.some((c) => c.class_id === classId)) {
      throw new Error(`班级编号 "${classId}" 不存在。请先用 eaa_create_class 创建班级`)
    }
    if (!Array.isArray(params.names) || params.names.length === 0) {
      throw new Error('names 不能为空')
    }
    if (params.names.length > MAX_IMPORT_NAMES) {
      throw new Error(`单次最多导入 ${MAX_IMPORT_NAMES} 人，本次 ${params.names.length} 人`)
    }

    const imported: string[] = []
    const assignedExisting: string[] = []
    const failed: Array<{ name: string; error: string }> = []
    const seen = new Set<string>()
    const skippedDuplicates: string[] = []

    for (const raw of params.names) {
      if (signal?.aborted) return textResult('已取消')
      let name = ''
      try {
        name = sanitizeName(String(raw ?? ''), 'name')
      } catch (err) {
        failed.push({
          name: String(raw ?? ''),
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
        const errText = `${addRes.stderr || ''} ${typeof addRes.data === 'string' ? addRes.data : ''}`
        const already = /already|已存在|exists/i.test(errText)
        if (!already) {
          failed.push({ name, error: addRes.stderr || '添加失败' })
          continue
        }
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
      if (added) imported.push(name)
      else assignedExisting.push(name)
    }

    invalidateClassContextCache()
    return jsonResult(
      {
        class_id: classId,
        requested: params.names.length,
        imported: imported.length,
        assigned_existing: assignedExisting.length,
        skipped_duplicates: skippedDuplicates,
        failed,
        imported_names: imported,
        assigned_existing_names: assignedExisting,
      },
      `导入完成: 新增 ${imported.length} 人，已存在并分班 ${assignedExisting.length} 人，失败 ${failed.length} 人` +
        (skippedDuplicates.length ? `，名单内重名跳过 ${skippedDuplicates.length} 人` : ''),
    )
  },
}
