// =============================================================
// Class CRUD handler — 班级列表/新建/更新/存档/恢复/删除(含级联清理)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ClassUpsertParams } from '@shared/types'
import type { IpcMainInvokeEvent } from 'electron'
import { classService } from '../../services/class-service'
import { eaaBridge } from '../../services/eaa-bridge'
import { invalidateStudentsCacheNow } from '../eaa/cache'
import { handleIpc } from '../handle'
import { requireClassId } from './params'

export function registerClassCrudHandlers(): void {
  // [r] 列出所有班级
  handleIpc(IPC.IPC_CLASS_LIST, async () => {
    return { success: true, data: classService.list() }
  })

  // [w] 新建班级
  handleIpc(IPC.IPC_CLASS_CREATE, async (_e: IpcMainInvokeEvent, params: ClassUpsertParams) => {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' }
    }
    return classService.create(params)
  })

  // [w] 更新班级信息（名称/年级/备注/班主任）
  handleIpc(
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
      const invalidId = requireClassId(id)
      if (invalidId) return invalidId
      return classService.update(id, fields)
    },
    {
      label: (id: string) => `class:update failed for "${id}"`,
    },
  )

  // [w] 存档班级（标记隐藏，数据保留）
  handleIpc(
    IPC.IPC_CLASS_ARCHIVE,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const invalidId = requireClassId(id)
      if (invalidId) return invalidId
      return classService.archive(id)
    },
    {
      label: (id: string) => `class:archive failed for "${id}"`,
    },
  )

  // [w] 恢复班级（取消存档）
  handleIpc(
    IPC.IPC_CLASS_RESTORE,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const invalidId = requireClassId(id)
      if (invalidId) return invalidId
      return classService.restore(id)
    },
    {
      label: (id: string) => `class:restore failed for "${id}"`,
    },
  )

  // [c] 删除班级（仅删本地记录，学生保留）— UI 层应二次确认
  handleIpc(
    IPC.IPC_CLASS_DELETE,
    async (_e: IpcMainInvokeEvent, id: string) => {
      const invalidId = requireClassId(id)
      if (invalidId) return invalidId
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
        invalidateStudentsCacheNow()
      }
      return result
    },
    {
      label: (id: string) => `class:delete failed for "${id}"`,
    },
  )
}
