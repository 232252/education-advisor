// =============================================================
// Class Service — 班级管理（本地：存档/删除）
// 班级记录存于 workstation.db 的 classes 表。
// class_id 与 EAA 学生的 class_id 字段对齐（弱关联）。
//
// 设计要点：
//   - 存档(archive)：仅打 archived=1 标记，学生数据完整保留，
//     前端默认在列表/Dashboard 中隐藏该班学生，可一键恢复。
//   - 删除(delete)：仅删本地 classes 记录，不动 EAA 学生数据
//     （学生记录保留，其 class_id 字段仍指向已删除的班级，
//      但因本地无该班级记录，前端会把他们归入"未分班/其他"）。
// =============================================================

import { randomUUID } from 'node:crypto'
import type { ClassEntity, ClassUpsertParams } from '../../shared/types'
import type { ClassRecord } from './db-service'
import { dbService } from './db-service'

/** DB 行（archived 为 0/1）转前端实体（archived 为 boolean） */
function toEntity(row: ClassRecord | null | undefined): ClassEntity | null {
  if (!row) return null
  return {
    id: String(row.id),
    class_id: String(row.class_id),
    name: String(row.name),
    grade: (row.grade as string | null) ?? undefined,
    note: (row.note as string | null) ?? undefined,
    archived: Number(row.archived) === 1,
    created_at: Number(row.created_at),
    archived_at: (row.archived_at as number | null) ?? undefined,
    teacher:
      ((row as ClassRecord & { teacher?: string | null }).teacher as string | null) ?? undefined,
  }
}

/** 校验 class_id：与 eaa-handlers 的 sanitizeClassId 保持一致（字母数字/./-，≤32） */
function validateClassId(classId: string): string {
  if (typeof classId !== 'string') throw new Error('classId must be a string')
  const trimmed = classId.trim()
  if (trimmed.length === 0) throw new Error('classId cannot be empty')
  if (trimmed.length > 32) throw new Error('classId too long (max 32 chars)')
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) {
    throw new Error('classId must be alphanumeric, dot or hyphen only')
  }
  return trimmed
}

function validateName(name: string): string {
  if (typeof name !== 'string') throw new Error('name must be a string')
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('班级名称不能为空')
  if (trimmed.length > 64) throw new Error('班级名称过长（最多 64 字符）')
  if (trimmed.startsWith('--')) throw new Error('班级名称不能以 -- 开头')
  return trimmed
}

class ClassService {
  /** 列出所有班级（未存档在前） */
  list(): ClassEntity[] {
    return dbService.listClasses().map((r) => toEntity(r) as ClassEntity)
  }

  /** 新建班级。class_id 已存在则返回错误 */
  create(params: ClassUpsertParams): { success: boolean; data?: ClassEntity; error?: string } {
    try {
      const classId = validateClassId(params.class_id)
      const name = validateName(params.name)
      if (dbService.getClassByClassId(classId)) {
        return { success: false, error: `班级编号 "${classId}" 已存在` }
      }
      const record = {
        id: randomUUID(),
        class_id: classId,
        name,
        grade: params.grade?.trim() || undefined,
        note: params.note?.trim() || undefined,
        teacher: params.teacher?.trim() || null,
        archived: 0 as const,
        created_at: Date.now(),
      } as ClassRecord
      if (!dbService.insertClass(record)) {
        return { success: false, error: dbService.getLastError() ?? '写入数据库失败' }
      }
      return { success: true, data: toEntity(record) ?? undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  /** 更新班级信息（名称/年级/备注） */
  update(
    id: string,
    fields: {
      name?: string
      grade?: string | null
      note?: string | null
      teacher?: string | null
    },
  ): { success: boolean; error?: string } {
    try {
      const update: {
        name?: string
        grade?: string | null
        note?: string | null
        teacher?: string | null
      } = {}
      if (fields.name !== undefined) update.name = validateName(fields.name)
      if (fields.grade !== undefined) update.grade = fields.grade?.trim() || null
      if (fields.note !== undefined) update.note = fields.note?.trim() || null
      if (fields.teacher !== undefined) {
        const t = fields.teacher?.trim()
        update.teacher = t && t.length > 0 ? t : null
      }
      if (!dbService.updateClass(id, update)) {
        return { success: false, error: dbService.getLastError() ?? '班级不存在或更新失败' }
      }
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  /** 存档班级（不再教，标记隐藏，数据保留） */
  archive(id: string): { success: boolean; error?: string } {
    if (!dbService.updateClass(id, { archived: 1, archived_at: Date.now() })) {
      return { success: false, error: dbService.getLastError() ?? '班级不存在' }
    }
    return { success: true }
  }

  /** 恢复班级（取消存档） */
  restore(id: string): { success: boolean; error?: string } {
    if (!dbService.updateClass(id, { archived: 0, archived_at: null })) {
      return { success: false, error: dbService.getLastError() ?? '班级不存在' }
    }
    return { success: true }
  }

  /**
   * 删除班级（仅删本地记录，学生数据保留）。
   * 返回被删班级的 class_id（供前端提示）。
   */
  delete(id: string): { success: boolean; classId?: string; error?: string } {
    const record = dbService.getClassById(id)
    if (!record) {
      return { success: false, error: '班级不存在' }
    }
    if (!dbService.deleteClass(id)) {
      return { success: false, error: dbService.getLastError() ?? '删除失败' }
    }
    return { success: true, classId: record.class_id }
  }
}

export const classService = new ClassService()
