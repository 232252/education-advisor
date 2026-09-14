// =============================================================
// Preload API — AI 批改 (Grading) 域
// =============================================================

import type { GradingAPI, GradingRosterEntry } from '@shared/api/grading'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import type { GradingTaskStatus, TeacherReview } from '@shared/types'
import { subscribe } from './subscribe'

export const gradingApi: GradingAPI = {
  // [r] 任务列表
  listTasks: () => ipcInvoke(IPC.IPC_GRADING_LIST),
  // [r] 单个任务
  getTask: (taskId: string) => ipcInvoke(IPC.IPC_GRADING_GET, taskId),
  // [w] 新建任务
  createTask: (input: unknown) => ipcInvoke(IPC.IPC_GRADING_CREATE, input),
  // [w] 更新任务
  updateTask: (taskId: string, patch: unknown) => ipcInvoke(IPC.IPC_GRADING_UPDATE, taskId, patch),
  // [c] 删除任务 — UI 二次确认
  deleteTask: (taskId: string) => ipcInvoke(IPC.IPC_GRADING_DELETE, taskId),
  // [w] 导入试卷
  importPapers: (taskId: string, batches) =>
    ipcInvoke(IPC.IPC_GRADING_IMPORT_PAPERS, taskId, batches),
  // [w] 归组指派
  assignPaper: (taskId: string, paperId: string, studentName: string | null) =>
    ipcInvoke(IPC.IPC_GRADING_ASSIGN_PAPER, taskId, paperId, studentName),
  // [w] 移除试卷
  removePaper: (taskId: string, paperId: string) =>
    ipcInvoke(IPC.IPC_GRADING_REMOVE_PAPER, taskId, paperId),
  // [w] 保存复核
  saveReview: (taskId: string, paperId: string, review: TeacherReview) =>
    ipcInvoke(IPC.IPC_GRADING_SAVE_REVIEW, taskId, paperId, review),
  // [w] 状态迁移
  setStatus: (taskId: string, status: GradingTaskStatus) =>
    ipcInvoke(IPC.IPC_GRADING_SET_STATUS, taskId, status),
  // [w] 启动 AI 批改(异步作业,进度经 onProgress)
  run: (taskId: string, roster?: GradingRosterEntry[]) =>
    ipcInvoke(IPC.IPC_GRADING_RUN, taskId, roster),
  // [w] 重改指定试卷(覆盖上次 AI 结果与复核)
  regrade: (taskId: string, paperIds: string[]) =>
    ipcInvoke(IPC.IPC_GRADING_REGRADE, taskId, paperIds),
  // [w] 中止批改
  abort: (taskId: string) => ipcInvoke(IPC.IPC_GRADING_ABORT, taskId),
  // [event] 批改进度
  onProgress: (callback: (data: import('@shared/types').GradingProgressEvent) => void) =>
    subscribe(IPC.IPC_GRADING_PROGRESS, callback),
  // [r] 读取试卷扫描件(base64 预览)
  readPaperFile: (taskId: string, storedName: string) =>
    ipcInvoke(IPC.IPC_GRADING_READ_FILE, taskId, storedName),
  // [w] 发布批改结果进学业管线
  publish: (taskId: string) => ipcInvoke(IPC.IPC_GRADING_PUBLISH, taskId),
  // [w] 样卷识别→量规草稿(视觉模型,无状态)
  extractRubric: (paths: string[]) => ipcInvoke(IPC.IPC_GRADING_EXTRACT_RUBRIC, paths),
  // [w] 从卷面手写姓名/编号识别归属(视觉模型;唯一命中才自动指派)
  identifyPapers: (taskId, roster) => ipcInvoke(IPC.IPC_GRADING_IDENTIFY_PAPERS, taskId, roster),
}
