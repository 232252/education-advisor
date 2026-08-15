// =============================================================
// 学业管理 (Academics) 类型 — 考试 / 科目 / 成绩 / 学生扩展档案
// =============================================================

/** 考试类型 */
export type ExamType = 'monthly' | 'midterm' | 'final' | 'quiz' | 'test' | 'mock' | 'other'

/** 科目分类 */
export type SubjectCategory = 'core' | 'science' | 'arts' | 'pe' | 'art' | 'other'

/** 科目定义 */
export interface SubjectDef {
  id: string
  name: string
  category: SubjectCategory
  fullMark: number
  /** 是否为主科(语数英) */
  isCore?: boolean
}

/** 考试定义 */
export interface ExamDef {
  id: string
  name: string
  type: ExamType
  date: string
  semester: string
  scope?: string
  /** 包含的科目ID列表 */
  subjects: string[]
  createdAt: string
}

/** 试卷分析结果 (占位结构,后续接入 AI/OCR) */
export interface PaperAnalysisResult {
  filePath: string
  fileName: string
  fileType: string
  examId: string | null
  subjectId: string | null
  questionScores: number[]
  analysis: string
  analyzedAt: string
}

/** 成绩记录 (单个学生在单场考试的单科成绩) */
export interface GradeRecord {
  examId: string
  subjectId: string
  studentName: string
  /** 分数; null 表示缺考 */
  score: number | null
  fullMark: number
  /** 班级排名(可选) */
  classRank?: number
  /** 年级排名(可选) */
  gradeRank?: number
  /** 班级平均分(可选,用于对比) */
  classAverage?: number
  /** 年级平均分(可选) */
  gradeAverage?: number
  note?: string
  /** 试卷分析结果 */
  paperAnalysis?: {
    questionScores?: number[]
    analysis?: string
    analyzedAt?: string
  }
  updatedAt: string
}

/** 学业配置 */
export interface AcademicConfig {
  subjects: SubjectDef[]
  defaultExamTypes: { value: ExamType; label: string }[]
}

/** 成绩录入模式 */
export type GradeEntryMode = 'single-subject' | 'all-subjects'

/** 学生扩展档案 */
export interface StudentProfileData {
  idCard?: string
  gender?: '男' | '女'
  birthDate?: string
  phone?: string
  address?: string
  parentName?: string
  parentPhone?: string
  enrollmentDate?: string
  comments?: string
  midtermGrades?: Record<string, number>
  finalGrades?: Record<string, number>
  attendanceRate?: number
  awards?: string[]
  [key: string]: unknown
}
