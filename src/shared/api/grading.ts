// =============================================================
// 批改域 API 类型(单一来源: preload 实现按此注解)
// =============================================================

import type {
  GradingProgressEvent,
  GradingTask,
  GradingTaskStatus,
  TeacherReview,
} from '@shared/types'

/** 批改域统一结果信封 */
export interface GradingResult<T> {
  success: boolean
  error?: string
  data?: T
}

export interface ImportPaperBatch {
  /** 本地文件绝对路径(renderer 经 sys:open-dialog 取得) */
  files: Array<{ path: string; name?: string }>
}

export interface GradingAPI {
  // [r] 任务列表(按更新时间倒序)
  listTasks: () => Promise<GradingResult<GradingTask[]>>
  // [r] 单个任务(含量规/试卷/AI结果/复核)
  getTask: (taskId: string) => Promise<GradingResult<GradingTask>>
  // [w] 新建任务(草稿态)
  createTask: (input: unknown) => Promise<GradingResult<GradingTask>>
  // [w] 更新元数据/量规(量规在 review/published 锁定)
  updateTask: (taskId: string, patch: unknown) => Promise<GradingResult<GradingTask>>
  // [c] 删除任务(连带扫描件) — UI 层应二次确认
  deleteTask: (taskId: string) => Promise<GradingResult<void>>
  // [w] 导入试卷(每批=一份试卷的多页)
  importPapers: (taskId: string, batches: ImportPaperBatch[]) => Promise<GradingResult<GradingTask>>
  // [w] 归组指派(null=取消归属)
  assignPaper: (
    taskId: string,
    paperId: string,
    studentName: string | null,
  ) => Promise<GradingResult<GradingTask>>
  // [w] 移除一份试卷(连带其文件)
  removePaper: (taskId: string, paperId: string) => Promise<GradingResult<GradingTask>>
  // [w] 保存教师复核(改分/评语/总评)
  saveReview: (
    taskId: string,
    paperId: string,
    review: TeacherReview,
  ) => Promise<GradingResult<GradingTask>>
  // [w] 状态机迁移(非法迁移由服务层拒绝)
  setStatus: (taskId: string, status: GradingTaskStatus) => Promise<GradingResult<GradingTask>>
  // [w] 启动 AI 批改(异步作业:同步校验失败即返回错误,进度经 onProgress)
  run: (taskId: string) => Promise<GradingResult<void>>
  // [w] 中止批改(返回是否确有进行中的作业)
  abort: (taskId: string) => Promise<GradingResult<boolean>>
  // [event] 批改进度(每份开始/完成/失败 + 整批 done)
  onProgress: (callback: (data: GradingProgressEvent) => void) => () => void
  // [r] 读取试卷扫描件(base64 预览)
  readPaperFile: (
    taskId: string,
    storedName: string,
  ) => Promise<GradingResult<{ mime: string; base64: string }>>
  // [w] 发布批改结果进学业管线(幂等;返回发布条数与跳过清单)
  publish: (taskId: string) => Promise<
    GradingResult<{
      published: number
      skipped: Array<{ paperId: string; studentName: string | null; reason: string }>
    }>
  >
}
