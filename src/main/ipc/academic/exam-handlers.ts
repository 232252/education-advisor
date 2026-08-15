// =============================================================
// Academic 考试 handler — 考试列表/新建/删除
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ExamDef } from '@shared/types'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { academicService } from '../../services/academic-service'
import { academicCache, invalidateOnExamsWrite } from './cache'

export function registerAcademicExamHandlers(): void {
  // 列出考试(可选 ?semester=xxx)
  ipcMain.handle(IPC.IPC_ACADEMIC_LIST_EXAMS, async (_e: IpcMainInvokeEvent, semester?: string) => {
    try {
      // R136 优化: TTL 缓存 key 按 semester 区分(空参 → 'all')
      const cacheKey = semester ?? 'all'
      const cached = academicCache.exams.get(cacheKey)
      if (cached) {
        return { success: true, data: cached }
      }
      const data = await academicService.listExams(semester)
      academicCache.exams.set(cacheKey, data)
      return { success: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] academic:list-exams failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 新建考试
  ipcMain.handle(
    IPC.IPC_ACADEMIC_CREATE_EXAM,
    async (_e: IpcMainInvokeEvent, exam: Omit<ExamDef, 'id' | 'createdAt'>) => {
      try {
        if (!exam || typeof exam !== 'object') {
          throw new Error('exam must be a non-null object')
        }
        if (!exam.name || typeof exam.name !== 'string') {
          throw new Error('exam.name is required')
        }
        if (!Array.isArray(exam.subjects)) {
          throw new Error('exam.subjects must be an array')
        }
        // Bug R111-2 修复: subjects 必须是 string[] (subject IDs)。
        // 旧实现只检查 Array.isArray, 接受对象数组后被存入 exams.json,
        // 导致 setGrade 的 exam.subjects.includes(subjectId) 永远 false。
        // 此处强制规范化为 string[], 拒绝非法元素。
        const normalizedSubjects: string[] = []
        for (const s of exam.subjects) {
          if (typeof s === 'string') {
            normalizedSubjects.push(s)
          } else if (s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string') {
            // 容错: 接受 {id, name, fullMark} 形式, 提取 id
            normalizedSubjects.push((s as { id: string }).id)
          } else {
            throw new Error('exam.subjects must be an array of subject ID strings')
          }
        }
        exam.subjects = normalizedSubjects
        const data = await academicService.createExam(exam)
        // R136: 新建考试会影响 listExams 结果, 失效所有 exams 缓存
        invalidateOnExamsWrite()
        return { success: true, data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:create-exam failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 删除考试
  ipcMain.handle(IPC.IPC_ACADEMIC_DELETE_EXAM, async (_e: IpcMainInvokeEvent, examId: string) => {
    try {
      if (typeof examId !== 'string' || examId.trim().length === 0) {
        throw new Error('examId must be a non-empty string')
      }
      await academicService.deleteExam(examId)
      // R136: deleteExam 会级联删除成绩, 失效 exams + grades + classGrades
      invalidateOnExamsWrite()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] academic:delete-exam failed:', msg)
      return { success: false, error: msg }
    }
  })
}
