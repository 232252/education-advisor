// =============================================================
// IPC API 类型 — 学业管理域 (window.api.academic)
// =============================================================

import type { AcademicConfig, ExamDef, GradeRecord } from '@shared/types'

export interface AcademicAPI {
  getConfig: () => Promise<{ success: boolean; data?: AcademicConfig; error?: string }>
  listExams: (semester?: string) => Promise<{ success: boolean; data?: ExamDef[]; error?: string }>
  createExam: (
    exam: Omit<ExamDef, 'id' | 'createdAt'>,
  ) => Promise<{ success: boolean; data?: ExamDef; error?: string }>
  deleteExam: (examId: string) => Promise<{ success: boolean; error?: string }>
  getGrades: (
    studentName: string,
  ) => Promise<{ success: boolean; data?: GradeRecord[]; error?: string }>
  batchSetGrades: (
    records: Omit<GradeRecord, 'updatedAt'>[],
  ) => Promise<{ success: boolean; data?: number; error?: string }>
  getClassGrades: (
    studentNames: string[],
    examId: string,
    subjectId?: string,
  ) => Promise<{
    success: boolean
    data?: Record<string, GradeRecord[]>
    error?: string
  }>
}
