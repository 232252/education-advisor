// =============================================================
// Class 调班 handler — 批量分入班级(EAA set-student-meta)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ClassAssignParams } from '@shared/types'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { classService } from '../../services/class-service'
import { eaaBridge } from '../../services/eaa-bridge'
import { invalidateStudentsCacheExternal } from '../eaa-handlers'
import { sanitizeClassId, sanitizeName } from './params'

export function registerClassAssignHandlers(): void {
  // [w] 调班：把多个学生分入某班级（批量设置 EAA class_id）
  // EAA 写命令经 writeQueue 串行化，循环调用安全但较慢（N 次 spawn）。
  // 因 spawn 串行且每次都要读写 entities.json，大批量（如数百人）耗时较长，
  // 故在循环中通过 webContents.send 实时推送进度，避免前端长时间无反馈。
  ipcMain.handle(IPC.IPC_CLASS_ASSIGN, async (e: IpcMainInvokeEvent, params: ClassAssignParams) => {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' }
    }
    try {
      const classId = sanitizeClassId(params.class_id)
      if (!Array.isArray(params.student_names) || params.student_names.length === 0) {
        return { success: false, error: 'student_names must be a non-empty array' }
      }
      // 校验目标班级是否存在 (防止将学生分配到不存在的 class_id, 造成数据完整性缺口)
      const existingClasses = classService.list()
      const classExists = existingClasses.some((c) => c.class_id === classId)
      if (!classExists) {
        return { success: false, error: `class_id "${classId}" does not exist` }
      }
      const names = params.student_names.map((n) => String(n))
      const total = names.length
      const failed: string[] = []
      let assigned = 0
      let current = 0
      const sendProgress = (current: number, total: number, assigned: number, lastName: string) => {
        try {
          if (!e.sender.isDestroyed()) {
            e.sender.send(IPC.IPC_CLASS_ASSIGN_PROGRESS, { current, total, assigned, lastName })
          }
        } catch {
          /* 渲染进程可能已卸载，忽略 */
        }
      }
      // 开始前先发一次 0/total，让前端立即进入「处理中」状态
      sendProgress(0, total, 0, '')
      for (const rawName of names) {
        const name = sanitizeName(rawName, 'student_name')
        const res = await eaaBridge.execute({
          command: 'set-student-meta',
          args: [name, '--class-id', classId],
        })
        if (res.success) {
          assigned += 1
        } else {
          failed.push(`${name}: ${res.stderr || '未知错误'}`)
        }
        current += 1
        // 每处理完一个就推送进度
        sendProgress(current, total, assigned, name)
      }
      // 调班后让 listStudents 缓存失效,下一次加载看到新班级
      invalidateStudentsCacheExternal()
      return { success: true, assigned, failed }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })
}
