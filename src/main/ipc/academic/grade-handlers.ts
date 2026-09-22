// =============================================================
// Academic 成绩 handler — 批量/班级成绩读写
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { GradeRecord } from '@shared/types'
import type { IpcMainInvokeEvent } from 'electron'
import { academicService } from '../../services/academic-service'
import { sanitizeName } from '../../utils/sanitize'
import { handleIpc } from '../handle'
import { academicCache, invalidateOnGradesWrite } from './cache'

export function registerAcademicGradeHandlers(): void {
  // 读取学生成绩
  handleIpc(IPC.IPC_ACADEMIC_GET_GRADES, async (_e: IpcMainInvokeEvent, studentName: string) => {
    const safeName = sanitizeName(studentName, 'name')
    // R136 优化: TTL 缓存按学生姓名 key, 避免重复 readFile grades/{name}.json
    const cached = academicCache.grades.get(safeName)
    if (cached) {
      return { success: true, data: cached }
    }
    const data = await academicService.getGrades(safeName)
    academicCache.grades.set(safeName, data)
    return { success: true, data }
  })

  // 批量设置成绩
  handleIpc(
    IPC.IPC_ACADEMIC_BATCH_SET_GRADES,
    async (_e: IpcMainInvokeEvent, records: Omit<GradeRecord, 'updatedAt'>[]) => {
      if (!Array.isArray(records)) {
        throw new Error('records must be an array')
      }
      // 空数组幂等返回 (与 deleteExam 不存在 id / getGrades 不存在学生返回 []
      // 的批量幂等约定一致), 避免把 service 层前置条件泄漏给前端
      if (records.length === 0) {
        return { success: true, data: 0 }
      }
      for (const r of records) {
        if (!r || typeof r !== 'object') {
          throw new Error('each record must be a non-null object')
        }
        if (typeof r.examId !== 'string' || !r.examId) {
          throw new Error('each record must have examId')
        }
        if (typeof r.subjectId !== 'string' || !r.subjectId) {
          throw new Error('each record must have subjectId')
        }
        if (typeof r.studentName !== 'string' || !r.studentName) {
          throw new Error('each record must have studentName')
        }
        r.studentName = sanitizeName(r.studentName, 'name')
      }
      const count = await academicService.batchSetGrades(records)
      // R136: 失效涉及的全部学生 grades + classGrades
      const affected = Array.from(new Set(records.map((r) => r.studentName)))
      invalidateOnGradesWrite(affected)
      return { success: true, data: count }
    },
  )

  // 删除一个学生在某场考试的全部记录(清幽灵成绩) — UI 层应二次确认
  handleIpc(
    IPC.IPC_ACADEMIC_REMOVE_GRADES,
    async (_e: IpcMainInvokeEvent, studentName: string, examId: string) => {
      if (typeof studentName !== 'string' || !studentName) {
        throw new Error('studentName must be a non-empty string')
      }
      if (typeof examId !== 'string' || !examId) {
        throw new Error('examId must be a non-empty string')
      }
      const safeName = sanitizeName(studentName, 'name')
      const removed = await academicService.removeGrades(safeName, examId)
      invalidateOnGradesWrite([safeName])
      return { success: true, data: removed }
    },
  )

  // 读取班级成绩(参数: studentNames[], examId, subjectId?; examId 为空串表示全部考试)
  handleIpc(
    IPC.IPC_ACADEMIC_GET_CLASS_GRADES,
    async (_e: IpcMainInvokeEvent, studentNames: string[], examId: string, subjectId?: string) => {
      if (!Array.isArray(studentNames)) {
        throw new Error('studentNames must be an array')
      }
      if (typeof examId !== 'string') {
        throw new Error('examId must be a string')
      }
      const safeNames = studentNames.map((n) => sanitizeName(n, 'name'))
      // R136 优化: TTL 缓存 key = sortedNames|examId|subjectId
      // (排序保证不同顺序的同集合命中同一 key)
      const cacheKey = `${safeNames.slice().sort().join(',')}|${examId}|${subjectId ?? 'all'}`
      const cached = academicCache.classGrades.get(cacheKey)
      if (cached) {
        return { success: true, data: cached }
      }
      const data = await academicService.getClassGrades(safeNames, examId, subjectId)
      academicCache.classGrades.set(cacheKey, data)
      return { success: true, data }
    },
  )
}
