// =============================================================
// 学业管理 API 类型(单一来源: preload 实现按此注解)
// =============================================================

import type { AcademicConfig, ExamDef, GradeRecord } from '@shared/types'

/** 学业域统一结果信封 */
export interface AcademicResult<T> {
  success: boolean
  error?: string
  data?: T
}

export interface AcademicAPI {
  // [r] 学业配置(科目定义/考试类型)
  getConfig: () => Promise<AcademicResult<AcademicConfig>>
  // [r] 考试列表(可选按学期过滤)
  listExams: (semester?: string) => Promise<AcademicResult<ExamDef[]>>
  // [w] 新建考试,返回创建后的完整考试对象
  createExam: (exam: unknown) => Promise<AcademicResult<ExamDef>>
  // [c] 删除考试(级联删除成绩) — UI 层应二次确认
  deleteExam: (examId: string) => Promise<AcademicResult<void>>
  // [r] 学生全部成绩
  getGrades: (studentName: string) => Promise<AcademicResult<GradeRecord[]>>
  // [w] 批量设置成绩
  batchSetGrades: (records: unknown) => Promise<AcademicResult<void>>
  // [r] 班级成绩(学生名 → 成绩记录)
  getClassGrades: (
    studentNames: string[],
    examId: string,
    subjectId?: string,
  ) => Promise<AcademicResult<Record<string, GradeRecord[]>>>
}
