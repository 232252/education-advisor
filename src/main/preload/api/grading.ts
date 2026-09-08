// =============================================================
// Preload API — AI 批改 (Grading) 域
// =============================================================

import type { GradingAPI } from '@shared/api/grading'
import * as IPC from '@shared/ipc-channels'
import type { GradingTaskStatus, TeacherReview } from '@shared/types'
import { ipcRenderer } from 'electron'
import { subscribe } from './subscribe'

export const gradingApi: GradingAPI = {
  // [r] 任务列表
  listTasks: () => ipcRenderer.invoke(IPC.IPC_GRADING_LIST),
  // [r] 单个任务
  getTask: (taskId: string) => ipcRenderer.invoke(IPC.IPC_GRADING_GET, taskId),
  // [w] 新建任务
  createTask: (input: unknown) => ipcRenderer.invoke(IPC.IPC_GRADING_CREATE, input),
  // [w] 更新任务
  updateTask: (taskId: string, patch: unknown) =>
    ipcRenderer.invoke(IPC.IPC_GRADING_UPDATE, taskId, patch),
  // [c] 删除任务 — UI 二次确认
  deleteTask: (taskId: string) => ipcRenderer.invoke(IPC.IPC_GRADING_DELETE, taskId),
  // [w] 导入试卷
  importPapers: (taskId: string, batches) =>
    ipcRenderer.invoke(IPC.IPC_GRADING_IMPORT_PAPERS, taskId, batches),
  // [w] 归组指派
  assignPaper: (taskId: string, paperId: string, studentName: string | null) =>
    ipcRenderer.invoke(IPC.IPC_GRADING_ASSIGN_PAPER, taskId, paperId, studentName),
  // [w] 移除试卷
  removePaper: (taskId: string, paperId: string) =>
    ipcRenderer.invoke(IPC.IPC_GRADING_REMOVE_PAPER, taskId, paperId),
  // [w] 保存复核
  saveReview: (taskId: string, paperId: string, review: TeacherReview) =>
    ipcRenderer.invoke(IPC.IPC_GRADING_SAVE_REVIEW, taskId, paperId, review),
  // [w] 状态迁移
  setStatus: (taskId: string, status: GradingTaskStatus) =>
    ipcRenderer.invoke(IPC.IPC_GRADING_SET_STATUS, taskId, status),
  // [w] 启动 AI 批改(异步作业,进度经 onProgress)
  run: (taskId: string) => ipcRenderer.invoke(IPC.IPC_GRADING_RUN, taskId),
  // [w] 中止批改
  abort: (taskId: string) => ipcRenderer.invoke(IPC.IPC_GRADING_ABORT, taskId),
  // [event] 批改进度
  onProgress: (callback: (data: import('@shared/types').GradingProgressEvent) => void) =>
    subscribe(IPC.IPC_GRADING_PROGRESS, callback),
}
