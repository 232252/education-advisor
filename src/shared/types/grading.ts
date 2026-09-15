// =============================================================
// 批改域 (Grading) 类型 — 内置 AI 批改作业子系统
//
// 数据模型以 Submitty 改卷链路为蓝本(参照 vendor/submitty/sql/)：
//   GradingTask      ≈ gradeable + electronic_gradeable(任务/窗口)
//   RubricQuestion   ≈ gradeable_component(题目组件: 满分/评分标准)
//   PresetMark       ≈ gradeable_component_mark(预设评分点 gcm_points/gcm_note)
//   GradingPaper     ≈ electronic_gradeable_data + _version(一次提交)
//   AiQuestionResult ≈ autograding_testcase_data(逐项得分)+依据
//   TeacherReview    ≈ gradeable_component_data(TA 改分) + grade_override(覆盖)
// =============================================================

import type { PageQuad } from '../grading-geometry'

/** 任务状态机: 草稿→就绪→AI批改中→待复核→已发布 */
export type GradingTaskStatus = 'draft' | 'ready' | 'grading' | 'review' | 'published'

/**
 * 批改口径(给分松紧): strict=按步从严/瑕疵必扣, normal=常规,
 * lenient=思路对从宽/小瑕疵少扣。影响批改 prompt 的给分松紧,不改量规本身。
 */
export type GradingStrictness = 'strict' | 'normal' | 'lenient'

/**
 * 批改模式(流程档位): fast=快改(整卷一次调用,不复验),
 * standard=标准(逐题细改+定位裁剪+条件复验,推荐), dual=双评
 * (两个视觉模型各自独立批改,阈值内取均值,分歧题交教师仲裁)。
 * 与 gradingMode(给分松紧口径)正交。
 */
export type GradingStrategy = 'fast' | 'standard' | 'dual'

/** 预设评分点(≈ gradeable_component_mark) */
export interface PresetMark {
  points: number
  note: string
}

/** 量规题目(≈ gradeable_component) */
export interface RubricQuestion {
  /** 任务内唯一,如 q-1 / q-2 */
  id: string
  /** 题号/题名 */
  title: string
  /**
   * 题类: objective=客观(选择/判断/填空,只标✓/✗/得分)
   * subjective=主观(简答/计算/作文,加页边批注)。缺省按标题关键词推导。
   */
  type?: 'objective' | 'subjective'
  /** 满分(≈ gc_max_value) */
  fullMark: number
  /** 参考答案/评分标准(喂给 AI 的判分依据) */
  referenceAnswer?: string
  /** 可选预设评分点(≈ gcm_*) */
  presetMarks?: PresetMark[]
  order: number
}

export type GradingPaperStatus = 'unassigned' | 'pending' | 'graded' | 'failed'

/** 试卷扫描件文件记录 */
export interface PaperFile {
  /** 原始文件名(展示用) */
  name: string
  /** 存储文件名(files/<taskId>/ 下唯一) */
  storedName: string
  mime: string
  bytes: number
}

/** 卷面批注框(相对该页宽高的 0–1 比例,供复核台叠字) */
export interface GradeAnnotationBox {
  /** 试卷图片页下标(0 起) */
  page: number
  x: number
  y: number
  w: number
  h: number
}

/** 套打校准(试打实测录入): 缩放 + 全局平移 */
export interface OverlayCalibration {
  dxMm: number
  dyMm: number
  scalePct: number
}

/** 套打回写设置(任务级) */
export interface OverlayPrintSettings {
  /** 纸张规格 id(@shared/grading-geometry PAPER_SPECS) */
  paperSpecId?: string
  calibration?: OverlayCalibration
}

/** AI 单题结果(≈ autograding_testcase_data 逐项得分 + 判分依据) */
export interface AiQuestionResult {
  questionId: string
  score: number
  /** 判分依据(对应评分标准的哪一条/哪一步) */
  evidence?: string
  /** 单题评语 */
  comment?: string
  /** AI 选用的评分点下标(对应 RubricQuestion.presetMarks) */
  appliedMarks?: number[]
  /** 错题/评语在卷面上的位置(没有则复核台只在右侧展示) */
  box?: GradeAnnotationBox
  /**
   * 扣分说明(未得满分的题逐项列出): points 为扣掉的分数(正数),
   * reason 为面向学生的扣分原因。满分题不应有扣分项。
   */
  deductions?: Array<{ points: number; reason: string }>
}

/** AI 批改结果(整份试卷) */
export interface AiGradeResult {
  questions: AiQuestionResult[]
  totalScore: number
  model: { provider: string; model: string }
  usage?: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }
  finishedAt: string
}

/** 教师复核(≈ TA component_data 改分 + grade_override) */
export interface TeacherReview {
  /** 逐题覆盖: 缺省项沿用 AI 分; marks 为点选的评分点下标 */
  questions: Record<string, { score?: number; comment?: string; marks?: number[] }>
  overallComment?: string
  reviewedAt: string
}

/** 卷面身份识别留痕:读到什么记什么,归组与否都保留供复核/排查 */
export interface PaperIdentityRecord {
  /** 卷面读到的姓名原文(空 = 未读出/字迹不清) */
  name: string
  /** 卷面读到的编号原文(学号/座号/考号,原样含前导零) */
  number: string
  /** 名单匹配候选(歧义时供一键指认;空 = 名单里对不上) */
  candidates: string[]
  /** 唯一命中并已自动归组的学生名 */
  matched?: string
  readAt: string
}

/** 一份试卷(一个学生的一次提交,可含多页扫描) */
export interface GradingPaper {
  id: string
  /** 归属学生(null = 未归组) */
  studentName: string | null
  files: PaperFile[]
  uploadedAt: string
  status: GradingPaperStatus
  ai?: AiGradeResult
  /** 双评模式: 第二模型的独立批改结果(原始保留,供复核台双屏对比) */
  aiSecondary?: AiGradeResult
  /** 双评分歧题(两次评分差超阈值,置顶复核由教师仲裁) */
  disputedQuestions?: string[]
  /** 批改失败原因 */
  error?: string
  review?: TeacherReview
  /** 最近一次卷面身份识别的结果 */
  identity?: PaperIdentityRecord
  /**
   * 套打定位四点(页下标对齐;null=该页未定位)。
   * 自动链 CV→AI 产出,人工四点可覆盖;详见 @shared/grading-geometry。
   */
  overlayQuads?: Array<PageQuad | null>
}

/** 批改任务(≈ gradeable) */
export interface GradingTask {
  id: string
  name: string
  semester: string
  classId?: string
  className?: string
  subjectId?: string
  /** 考试/作业日期(yyyy-mm-dd,发布时作为 ExamDef.date) */
  examDate?: string
  status: GradingTaskStatus
  /** 批改口径(缺省 normal);影响批改 prompt 的给分松紧 */
  gradingMode?: GradingStrictness
  /** 批改模式(缺省 standard);fast/standard/dual 见 GradingStrategy */
  gradingStrategy?: GradingStrategy
  rubric: RubricQuestion[]
  papers: GradingPaper[]
  createdAt: string
  updatedAt: string
  /** 发布时间与生成的考试 ID(发布后回填) */
  publishedAt?: string
  publishedExamId?: string
  /** 套打回写设置(纸张规格 + 试打校准) */
  overlayPrint?: OverlayPrintSettings
}

/** AI 批改进度事件(主→渲染推送) */
export interface GradingProgressEvent {
  taskId: string
  phase: 'start' | 'identify' | 'stage' | 'graded' | 'failed' | 'done'
  paperId?: string
  studentName?: string
  index?: number
  total?: number
  /** phase=stage: 当前批次的阶段名(如「定位版面」「批改 三、计算题」) */
  stage?: string
  /** phase=stage: 批次序号(1 起)与该卷批次总数 */
  stageIndex?: number
  stageTotal?: number
  /** phase=graded: 本份得分; phase=failed: 错误信息 */
  score?: number
  error?: string
  /** phase=done 汇总 */
  gradedCount?: number
  failedCount?: number
  aborted?: boolean
}
