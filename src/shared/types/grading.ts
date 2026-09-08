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

/** 任务状态机: 草稿→就绪→AI批改中→待复核→已发布 */
export type GradingTaskStatus = 'draft' | 'ready' | 'grading' | 'review' | 'published'

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

/** AI 单题结果(≈ autograding_testcase_data 逐项得分 + 判分依据) */
export interface AiQuestionResult {
  questionId: string
  score: number
  /** 判分依据(对应评分标准的哪一条/哪一步) */
  evidence?: string
  /** 单题评语 */
  comment?: string
}

/** AI 批改结果(整份试卷) */
export interface AiGradeResult {
  questions: AiQuestionResult[]
  totalScore: number
  model: { provider: string; model: string }
  usage?: { input: number; output: number }
  finishedAt: string
}

/** 教师复核(≈ TA component_data 改分 + grade_override) */
export interface TeacherReview {
  /** 逐题覆盖: 缺省项沿用 AI 分 */
  questions: Record<string, { score?: number; comment?: string }>
  overallComment?: string
  reviewedAt: string
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
  /** 批改失败原因 */
  error?: string
  review?: TeacherReview
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
  rubric: RubricQuestion[]
  papers: GradingPaper[]
  createdAt: string
  updatedAt: string
  /** 发布时间与生成的考试 ID(发布后回填) */
  publishedAt?: string
  publishedExamId?: string
}
