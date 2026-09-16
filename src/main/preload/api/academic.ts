// =============================================================
// Preload API — 学业管理 (Academics) 域
// =============================================================

import type { AcademicAPI } from '@shared/api/academic'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const academicApi: AcademicAPI = {
  // [r] 读取学业配置(科目定义/考试类型)
  getConfig: () => ipcInvoke(IPC.IPC_ACADEMIC_GET_CONFIG),
  // [r] 列出考试(可选按学期过滤)
  listExams: (semester?: string) => ipcInvoke(IPC.IPC_ACADEMIC_LIST_EXAMS, semester),
  // [w] 新建考试
  createExam: (exam: unknown) => ipcInvoke(IPC.IPC_ACADEMIC_CREATE_EXAM, exam),
  // [c] 删除考试(级联删除成绩) — UI 层应二次确认
  deleteExam: (examId: string) => ipcInvoke(IPC.IPC_ACADEMIC_DELETE_EXAM, examId),
  // [r] 读取学生全部成绩
  getGrades: (studentName: string) => ipcInvoke(IPC.IPC_ACADEMIC_GET_GRADES, studentName),
  // [c] 删除学生在某场考试的全部记录 — UI 层应二次确认
  removeGrades: (studentName: string, examId: string) =>
    ipcInvoke(IPC.IPC_ACADEMIC_REMOVE_GRADES, studentName, examId),
  // [w] 批量设置成绩
  batchSetGrades: (records: unknown) => ipcInvoke(IPC.IPC_ACADEMIC_BATCH_SET_GRADES, records),
  // [r] 读取班级成绩(参数: studentNames[], examId, subjectId?)
  getClassGrades: (studentNames: string[], examId: string, subjectId?: string) =>
    ipcInvoke(IPC.IPC_ACADEMIC_GET_CLASS_GRADES, studentNames, examId, subjectId),
}
