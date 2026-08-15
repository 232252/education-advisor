// =============================================================
// Class CRUD handler — 班级列表/新建/更新/存档/恢复/删除(含级联清理)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ClassUpsertParams } from '@shared/types'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { classService } from '../../services/class-service'
import { eaaBridge } from '../../services/eaa-bridge'
import { invalidateStudentsCacheExternal } from '../eaa-handlers'

export function registerClassCrudHandlers(): void {
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
  ipcMain.handle(
    IPC.IPC_CLASS_CREATE,
    async (_e: IpcMainInvokeEvent, params: ClassUpsertParams) => {
      try {
        if (!params || typeof params !== 'object') {
          return { success: false, error: 'params must be an object' }
        }
        return classService.create(params)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] class:create failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // [w] 更新班级信息（名称/年级/备注/班主任）
  ipcMain.handle(
    IPC.IPC_CLASS_UPDATE,
    async (
      _e: IpcMainInvokeEvent,
      id: string,
      fields: {
        name?: string
        grade?: string | null
        note?: string | null
        teacher?: string | null
      },
    ) => {
      try {
        if (typeof id !== 'string' || id.trim().length === 0) {
          return { success: false, error: 'id must be a non-empty string' }
        }
        return classService.update(id, fields)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] class:update failed for "${id}":`, msg)
        return { success: false, error: msg }
      }
    },
  )

  // [w] 存档班级（标记隐藏，数据保留）
  ipcMain.handle(IPC.IPC_CLASS_ARCHIVE, async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      if (typeof id !== 'string' || id.trim().length === 0) {
        return { success: false, error: 'id must be a non-empty string' }
      }
      return classService.archive(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] class:archive failed for "${id}":`, msg)
      return { success: false, error: msg }
    }
  })

  // [w] 恢复班级（取消存档）
  ipcMain.handle(IPC.IPC_CLASS_RESTORE, async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      if (typeof id !== 'string' || id.trim().length === 0) {
        return { success: false, error: 'id must be a non-empty string' }
      }
      return classService.restore(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] class:restore failed for "${id}":`, msg)
      return { success: false, error: msg }
    }
  })

  // [c] 删除班级（仅删本地记录，学生保留）— UI 层应二次确认
  ipcMain.handle(IPC.IPC_CLASS_DELETE, async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      if (typeof id !== 'string' || id.trim().length === 0) {
        return { success: false, error: 'id must be a non-empty string' }
      }
      const result = classService.delete(id)
      // 级联清理:把 EAA 中 class_id 指向该班的学生清除 class_id,避免"幽灵 class_id"导致数据不互通
      if (result.success && result.classId) {
        try {
          // eaaBridge.execute() 返回 EAAResult { success, data, stderr, exitCode }
          // list-students 命令的学生列表在 data.students 中
          const listRes = await eaaBridge.execute<{
            students?: Array<{ name: string; class_id?: string | null }>
          }>({ command: 'list-students', args: [] })
          const students = listRes?.data?.students ?? []
          const toClear = students.filter((s) => s.class_id === result.classId)
          console.log('[Class] cascade cleanup:', {
            classId: result.classId,
            totalStudents: students.length,
            toClearCount: toClear.length,
            sampleStudents: students
              .slice(0, 3)
              .map((s) => ({ name: s.name, class_id: s.class_id })),
            listSuccess: listRes?.success,
            listExitCode: listRes?.exitCode,
          })
          let clearedCount = 0
          for (const s of toClear) {
            try {
              const clearRes = await eaaBridge.execute({
                command: 'set-student-meta',
                args: [s.name, '--clear-class-id'],
              })
              console.log(`[Class] clear class_id for ${s.name}:`, {
                success: clearRes.success,
                exitCode: clearRes.exitCode,
                stderr: clearRes.stderr?.slice(0, 200),
                data:
                  typeof clearRes.data === 'string' ? clearRes.data.slice(0, 200) : clearRes.data,
              })
              if (clearRes.success) clearedCount++
            } catch (e) {
              console.warn(`[Class] clear class_id failed for ${s.name}:`, e)
            }
          }
          console.log(`[Class] cascade cleanup done: cleared ${clearedCount}/${toClear.length}`)
        } catch (e) {
          console.warn('[Class] cascade clear class_id failed:', e)
        }
        // 级联清理后让 students/ranking/score 缓存失效,确保下次加载看到最新数据
        invalidateStudentsCacheExternal()
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] class:delete failed for "${id}":`, msg)
      return { success: false, error: msg }
    }
  })
}
