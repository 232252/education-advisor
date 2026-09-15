// =============================================================
// 批改域 API 类型(单一来源: preload 实现按此注解)
// =============================================================

import type { PageQuad } from '@shared/grading-geometry'
import type {
  GradingProgressEvent,
  GradingTask,
  GradingTaskStatus,
  OverlayPrintSettings,
  PresetMark,
  RubricQuestion,
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

/** 卷面识别用的学生名单(姓名 + 学号/编号别名) */
export interface GradingRosterEntry {
  name: string
  aliases?: string[]
}

export interface IdentifyPapersResult {
  assigned: number
  unresolved: number
}

/** 样卷识别抽出的量规题草稿(IPC 契约层类型,非持久化任务模型,不进 types/grading.ts) */
export interface ExtractedRubricQuestion {
  title: string
  /** 题类: 客观(选择/判断/填空)只标符号/得分,主观(简答/计算/作文)加页边批注 */
  type?: 'objective' | 'subjective'
  fullMark: number
  /** 照录答案页原文;AI 自答草稿尾部带「AI 草稿」尾注供教师核对 */
  referenceAnswer?: string
}

/** 评分标准细化结果: 每题一组扣分点(只有可细化的题出现;教师校对后随量规保存) */
export interface RefinedRubricMarks {
  id: string
  presetMarks: PresetMark[]
}

/** 套打四点检测单页结果 */
export interface OverlayQuadPageResult {
  page: number
  ok: boolean
  source?: PageQuad['source']
  confidence?: number
  error?: string
}

/** 套打四点检测结果(单份试卷) */
export interface OverlayQuadDetectResult {
  paperId: string
  studentName: string | null
  pages: OverlayQuadPageResult[]
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
  run: (taskId: string, roster?: GradingRosterEntry[]) => Promise<GradingResult<void>>
  // [w] 重改指定试卷(覆盖上次 AI 结果与复核;异步作业,进度经 onProgress)
  regrade: (taskId: string, paperIds: string[]) => Promise<GradingResult<void>>
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
  // [w] 从样卷照片识别量规草稿(走视觉模型,复用批改模型配置;无状态不落盘)
  extractRubric: (paths: string[]) => Promise<GradingResult<ExtractedRubricQuestion[]>>
  // [w] 评分标准自动细化: 参考答案→逐题扣分点(纯文本模型;无状态,教师校对后保存)
  refineRubric: (questions: RubricQuestion[]) => Promise<GradingResult<RefinedRubricMarks[]>>
  // [w] 从卷面手写姓名/编号识别归属(视觉模型;唯一命中才自动指派)
  identifyPapers: (
    taskId: string,
    roster: GradingRosterEntry[],
  ) => Promise<GradingResult<IdentifyPapersResult>>
  // [w] 套打回写: 全任务定位四点检测(CV→AI 自动链;useAiFallback=false 只跑本地 CV)
  detectQuads: (
    taskId: string,
    opts?: { useAiFallback?: boolean },
  ) => Promise<GradingResult<{ task: GradingTask; results: OverlayQuadDetectResult[] }>>
  // [w] 套打回写: 保存单份试卷四点(人工四点校正)
  saveQuads: (
    taskId: string,
    paperId: string,
    quads: Array<PageQuad | null>,
  ) => Promise<GradingResult<GradingTask>>
  // [w] 套打回写: 保存纸张规格与试打校准
  saveOverlayPrint: (
    taskId: string,
    patch: OverlayPrintSettings,
  ) => Promise<GradingResult<GradingTask>>
  // [w] 套打回写: 静默连打(打印当前窗口;参数写死 100% 无边距)
  overlaySilentPrint: (
    taskId: string,
    opts: { deviceName?: string; paperSpecId?: string },
  ) => Promise<GradingResult<{ ok: boolean; reason?: string }>>
  // [w] 套打回写: 母版标定(样卷留档+AI 模板逐题定位)
  calibrateOverlayTemplate: (
    taskId: string,
    paths: string[],
  ) => Promise<
    GradingResult<{
      task: GradingTask
      result: { located: number; missing: string[]; pages: number; quadsOk: number }
    }>
  >
}
