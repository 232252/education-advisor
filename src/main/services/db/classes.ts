// =============================================================
// 班级记录 CRUD
// 从 db-service.ts DBService 对应方法拆分而来（逻辑逐字搬移,行为零变化）
// =============================================================

import type { DbClient } from './statements'
import type { ClassRecord } from './types'

/** 新增班级。class_id 唯一冲突时返回 false。 */
export function insertClass(ctx: DbClient, record: ClassRecord): boolean {
  if (!ctx.ready || !ctx.stmts.insertClass) return false
  try {
    ctx.stmts.insertClass.run({
      id: record.id,
      class_id: record.class_id,
      name: record.name,
      grade: record.grade ?? null,
      note: record.note ?? null,
      archived: record.archived,
      created_at: record.created_at,
      archived_at: record.archived_at ?? null,
      teacher: (record as ClassRecord & { teacher?: string | null }).teacher ?? null,
    })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] insertClass failed:', msg)
    return false
  }
}

/** 更新班级（名称/年级/备注/存档状态）。字段为 undefined/null 时不覆盖。 */
export function updateClass(
  ctx: DbClient,
  id: string,
  fields: {
    name?: string
    grade?: string | null
    note?: string | null
    archived?: 0 | 1
    archived_at?: number | null
    teacher?: string | null
  },
): boolean {
  if (!ctx.ready || !ctx.stmts.updateClass) return false
  try {
    const before = ctx.stmts.selectClassById?.get(id) as ClassRecord | undefined
    const r = ctx.stmts.updateClass.run({
      id,
      name: fields.name ?? '',
      grade: fields.grade !== undefined ? fields.grade : (before?.grade ?? null),
      note: fields.note !== undefined ? fields.note : (before?.note ?? null),
      archived: fields.archived !== undefined ? fields.archived : (before?.archived ?? 0),
      archived_at:
        fields.archived_at !== undefined ? fields.archived_at : (before?.archived_at ?? null),
      teacher: fields.teacher !== undefined ? fields.teacher : (before?.teacher ?? null),
    })
    return Number(r.changes) > 0
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] updateClass failed:', msg)
    return false
  }
}

/** 按主键 id 查询班级 */
export function getClassById(ctx: DbClient, id: string): ClassRecord | null {
  if (!ctx.ready || !ctx.stmts.selectClassById) return null
  try {
    return (ctx.stmts.selectClassById.get(id) as ClassRecord | undefined) ?? null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] getClassById failed:', msg)
    return null
  }
}

/** 按班级编号 class_id 查询班级（用于判断是否已存在/是否已存档） */
export function getClassByClassId(ctx: DbClient, classId: string): ClassRecord | null {
  if (!ctx.ready || !ctx.stmts.selectClassByClassId) return null
  try {
    return (ctx.stmts.selectClassByClassId.get(classId) as ClassRecord | undefined) ?? null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] getClassByClassId failed:', msg)
    return null
  }
}

/** 列出所有班级，未存档的排前面 */
export function listClasses(ctx: DbClient): ClassRecord[] {
  if (!ctx.ready || !ctx.stmts.listClasses) return []
  try {
    return ctx.stmts.listClasses.all() as ClassRecord[]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] listClasses failed:', msg)
    return []
  }
}

/** 删除班级记录（仅删本地记录，不动学生数据） */
export function deleteClass(ctx: DbClient, id: string): boolean {
  if (!ctx.ready || !ctx.stmts.deleteClass) return false
  try {
    const r = ctx.stmts.deleteClass.run(id)
    return Number(r.changes) > 0
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] deleteClass failed:', msg)
    return false
  }
}
