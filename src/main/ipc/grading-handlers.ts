// =============================================================
// Grading handlers — AI 批改任务 CRUD/试卷导入/归组/复核/批改执行
// 入参做轻量类型检查,深校验(状态机/量规/越界)在 grading-service。
// grading:run 为异步作业: 启动即返回,进度经 IPC_GRADING_PROGRESS 推送。
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { GradingTaskStatus, TeacherReview } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { abortGrading, startGrading } from '../services/grading/grading-pipeline'
import { gradingService } from '../services/grading/grading-service'
import { invalidateOnExamsWrite, invalidateOnGradesWrite } from './academic/cache'
import { handleIpc } from './handle'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function registerGradingHandlers(win: BrowserWindow): void {
  handleIpc(IPC.IPC_GRADING_LIST, async () => ({
    success: true,
    data: await gradingService.listTasks(),
  }))

  handleIpc(IPC.IPC_GRADING_GET, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    return { success: true, data: await gradingService.getTask(taskId) }
  })

  handleIpc(IPC.IPC_GRADING_CREATE, async (_e, input: unknown) => {
    if (!isRecord(input)) throw new Error('input 必须是对象')
    return { success: true, data: await gradingService.createTask(input as never) }
  })

  handleIpc(IPC.IPC_GRADING_UPDATE, async (_e, taskId: string, patch: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    if (!isRecord(patch)) throw new Error('patch 必须是对象')
    return { success: true, data: await gradingService.updateTask(taskId, patch as never) }
  })

  handleIpc(IPC.IPC_GRADING_DELETE, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    await gradingService.deleteTask(taskId)
    return { success: true }
  })

  handleIpc(IPC.IPC_GRADING_IMPORT_PAPERS, async (_e, taskId: string, batches: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    if (!Array.isArray(batches)) throw new Error('batches 必须是数组')
    return { success: true, data: await gradingService.importPapers(taskId, batches as never) }
  })

  handleIpc(
    IPC.IPC_GRADING_ASSIGN_PAPER,
    async (_e, taskId: string, paperId: string, studentName: string | null) => {
      if (typeof taskId !== 'string' || typeof paperId !== 'string') {
        throw new Error('taskId/paperId 必须是字符串')
      }
      if (studentName !== null && typeof studentName !== 'string') {
        throw new Error('studentName 必须是字符串或 null')
      }
      return {
        success: true,
        data: await gradingService.assignPaper(taskId, paperId, studentName),
      }
    },
  )

  handleIpc(IPC.IPC_GRADING_REMOVE_PAPER, async (_e, taskId: string, paperId: string) => {
    if (typeof taskId !== 'string' || typeof paperId !== 'string') {
      throw new Error('taskId/paperId 必须是字符串')
    }
    return { success: true, data: await gradingService.removePaper(taskId, paperId) }
  })

  handleIpc(
    IPC.IPC_GRADING_SAVE_REVIEW,
    async (_e, taskId: string, paperId: string, review: TeacherReview) => {
      if (typeof taskId !== 'string' || typeof paperId !== 'string') {
        throw new Error('taskId/paperId 必须是字符串')
      }
      if (!isRecord(review) || !isRecord(review.questions)) {
        throw new Error('review.questions 必须是对象')
      }
      return { success: true, data: await gradingService.saveReview(taskId, paperId, review) }
    },
  )

  handleIpc(IPC.IPC_GRADING_SET_STATUS, async (_e, taskId: string, status: GradingTaskStatus) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    const allowed: GradingTaskStatus[] = ['draft', 'ready', 'grading', 'review', 'published']
    if (!allowed.includes(status)) throw new Error(`非法状态: ${String(status)}`)
    return { success: true, data: await gradingService.setStatus(taskId, status) }
  })

  // 启动 AI 批改(异步作业: 校验同步完成即返回,进度经 grading:progress)
  handleIpc(IPC.IPC_GRADING_RUN, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    await startGrading(taskId, win)
    return { success: true }
  })

  // 中止批改(已完成的结果保留,可续批)
  handleIpc(IPC.IPC_GRADING_ABORT, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    return { success: true, data: abortGrading(taskId) }
  })

  // 复核工作台: 读取试卷扫描件(base64)
  handleIpc(IPC.IPC_GRADING_READ_FILE, async (_e, taskId: string, storedName: string) => {
    if (typeof taskId !== 'string' || typeof storedName !== 'string') {
      throw new Error('taskId/storedName 必须是字符串')
    }
    return { success: true, data: await gradingService.readPaperFile(taskId, storedName) }
  })

  // 发布批改结果进学业管线(成功后失效学业缓存,Agent/页面即时可见)
  handleIpc(IPC.IPC_GRADING_PUBLISH, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    const task = await gradingService.getTask(taskId)
    const result = await gradingService.publishTask(taskId)
    invalidateOnExamsWrite()
    invalidateOnGradesWrite(task.papers.map((p) => p.studentName ?? '').filter((n) => n.length > 0))
    return { success: true, data: result }
  })
}
