// =============================================================
// Class IPC 处理器 — 班级管理（本地：存档/删除）
// =============================================================

import { ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type {
  ClassAssignParams,
  ClassRemoveStudentParams,
  ClassUpsertParams,
} from '../../shared/types'
import { classService } from '../services/class-service'
import { eaaBridge } from '../services/eaa-bridge'

/** 复用 eaa-handlers 的 sanitize 思路：剥离不可见字符、限制长度。
 *  班级/学生名保持与 EAA 协议一致以避免 IPC 参数异常。 */
function sanitizeName(name: string, field: string): string {
  if (typeof name !== 'string') throw new Error(`${field} must be a string`)
  const cleaned = name
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) throw new Error(`${field} cannot be empty`)
  if (cleaned.length > 64) throw new Error(`${field} too long (max 64 chars)`)
  return cleaned
}

function sanitizeClassId(cid: string): string {
  if (typeof cid !== 'string') throw new Error('classId must be a string')
  const trimmed = cid.trim()
  if (trimmed.length === 0) throw new Error('classId cannot be empty')
  if (trimmed.length > 32) throw new Error('classId too long (max 32 chars)')
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) {
    throw new Error('classId must be alphanumeric, dot or hyphen only')
  }
  return trimmed
}

export function registerClassHandlers() {
  // [r] 列出所有班级
  ipcMain.handle(IPC.IPC_CLASS_LIST, async () => {
    try {
      return { success: true, data: classService.list() }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  // [w] 新建班级
  ipcMain.handle(IPC.IPC_CLASS_CREATE, async (_e, params: ClassUpsertParams) => {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' }
    }
    return classService.create(params)
  })

  // [w] 更新班级信息（名称/年级/备注/班主任）
  ipcMain.handle(
    IPC.IPC_CLASS_UPDATE,
    async (
      _e,
      id: string,
      fields: {
        name?: string
        grade?: string | null
        note?: string | null
        teacher?: string | null
      },
    ) => {
      if (typeof id !== 'string' || id.trim().length === 0) {
        return { success: false, error: 'id must be a non-empty string' }
      }
      return classService.update(id, fields)
    },
  )

  // [w] 存档班级（标记隐藏，数据保留）
  ipcMain.handle(IPC.IPC_CLASS_ARCHIVE, async (_e, id: string) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { success: false, error: 'id must be a non-empty string' }
    }
    return classService.archive(id)
  })

  // [w] 恢复班级（取消存档）
  ipcMain.handle(IPC.IPC_CLASS_RESTORE, async (_e, id: string) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { success: false, error: 'id must be a non-empty string' }
    }
    return classService.restore(id)
  })

  // [c] 删除班级（仅删本地记录，学生保留）— UI 层应二次确认
  ipcMain.handle(IPC.IPC_CLASS_DELETE, async (_e, id: string) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { success: false, error: 'id must be a non-empty string' }
    }
    return classService.delete(id)
  })

  // [w] 调班：把多个学生分入某班级（批量设置 EAA class_id）
  // EAA 写命令经 writeQueue 串行化，循环调用安全但较慢（N 次 spawn）。
  ipcMain.handle(IPC.IPC_CLASS_ASSIGN, async (_e, params: ClassAssignParams) => {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' }
    }
    try {
      const classId = sanitizeClassId(params.class_id)
      if (!Array.isArray(params.student_names) || params.student_names.length === 0) {
        return { success: false, error: 'student_names must be a non-empty array' }
      }
      const failed: string[] = []
      let assigned = 0
      for (const rawName of params.student_names) {
        const name = sanitizeName(String(rawName), 'student_name')
        const res = await eaaBridge.execute({
          command: 'set-student-meta',
          args: [name, '--class-id', classId],
        })
        if (res.success) {
          assigned += 1
        } else {
          failed.push(`${name}: ${res.stderr || '未知错误'}`)
        }
      }
      return { success: true, assigned, failed }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  // [w] 调班：把单个学生移出班级（清空 EAA class_id）
  ipcMain.handle(IPC.IPC_CLASS_REMOVE, async (_e, params: ClassRemoveStudentParams) => {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' }
    }
    try {
      const name = sanitizeName(params.student_name, 'student_name')
      const res = await eaaBridge.execute({
        command: 'set-student-meta',
        args: [name, '--clear-class-id'],
      })
      if (!res.success) {
        return { success: false, error: res.stderr || '未知错误' }
      }
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  console.log('[IPC] Class handlers registered')
}
