// =============================================================
// Preload API — AI 批改 (Grading) 域
// =============================================================

import type { GradingAPI, GradingRosterEntry } from '@shared/api/grading'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import type { GradingTaskStatus, PrintDuplexMode, TeacherReview } from '@shared/types'
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
  // [w] 多页归组人工合并(source 页面并入 anchor)
  mergePapers: (taskId: string, anchorId: string, sourceId: string) =>
    ipcInvoke(IPC.IPC_GRADING_MERGE_PAPERS, taskId, anchorId, sourceId),
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
  // [w] 评分标准自动细化: 参考答案→逐题扣分点(纯文本模型,无状态)
  refineRubric: (questions) => ipcInvoke(IPC.IPC_GRADING_REFINE_RUBRIC, questions),
  // [w] 从卷面手写姓名/编号识别归属(视觉模型;唯一命中才自动指派)
  identifyPapers: (taskId, roster) => ipcInvoke(IPC.IPC_GRADING_IDENTIFY_PAPERS, taskId, roster),
  // [w] 套打回写: 全任务定位四点检测(CV→AI 自动链)
  detectQuads: (taskId, opts) => ipcInvoke(IPC.IPC_GRADING_DETECT_QUADS, taskId, opts),
  // [w] 套打回写: 保存单份试卷四点(人工四点校正)
  saveQuads: (taskId, paperId, quads) =>
    ipcInvoke(IPC.IPC_GRADING_SAVE_QUADS, taskId, paperId, quads),
  // [w] 套打回写: 保存纸张规格与试打校准
  saveOverlayPrint: (taskId, patch) => ipcInvoke(IPC.IPC_GRADING_SAVE_OVERLAY_PRINT, taskId, patch),
  // [w] 套打回写: 静默连打
  overlaySilentPrint: (taskId, opts) =>
    ipcInvoke(IPC.IPC_GRADING_OVERLAY_SILENT_PRINT, taskId, opts),
  // [w] 套打回写: 母版标定
  calibrateOverlayTemplate: (taskId, paths) =>
    ipcInvoke(IPC.IPC_GRADING_CALIBRATE_TEMPLATE, taskId, paths),
  // [w] 成绩汇总 CSV 导出(渲染层保存对话框拿路径,主进程写盘)
  exportSummaryCsv: (taskId: string, filePath: string) =>
    ipcInvoke(IPC.IPC_GRADING_EXPORT_SUMMARY_CSV, taskId, filePath),
  // [w] 逐页批注 PDF 直出(当前窗口 printToPDF;英寸口径自定义纸)
  exportAnnotatedPdf: (
    taskId: string,
    opts: { filePath: string; paperSpecId?: string; duplexMode?: PrintDuplexMode },
  ) => ipcInvoke(IPC.IPC_GRADING_EXPORT_ANNOTATED_PDF, taskId, opts),
}
