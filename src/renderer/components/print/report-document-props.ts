// =============================================================
// 打印报告文档公共 Props — 学生维度报告共用的数据形状
// Student/Parent 两份报告文档字段一致,单一来源防漂移。
// =============================================================

import type {
  EAAHistoryEvent,
  EAAStudentScore,
  ExamDef,
  GradeRecord,
  StudentProfileData,
  SubjectDef,
} from '@shared/types'

/** 学生维度打印报告的公共入参 */
export interface ReportDocumentBaseProps {
  studentName: string
  classId?: string | null
  score: EAAStudentScore | null
  profileData: StudentProfileData
  events: EAAHistoryEvent[]
  grades: GradeRecord[]
  exams: ExamDef[]
  subjects: SubjectDef[]
  generatedAt?: Date
}
