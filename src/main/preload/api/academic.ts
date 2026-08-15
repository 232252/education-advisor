// =============================================================
// Preload API — 学业管理 (Academics) 域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const academicApi = {
  // [r] 读取学业配置(科目定义/考试类型)
  getConfig: () => ipcRenderer.invoke(IPC.IPC_ACADEMIC_GET_CONFIG),
  // [r] 列出考试(可选按学期过滤)
  listExams: (semester?: string) => ipcRenderer.invoke(IPC.IPC_ACADEMIC_LIST_EXAMS, semester),
  // [w] 新建考试
  createExam: (exam: unknown) => ipcRenderer.invoke(IPC.IPC_ACADEMIC_CREATE_EXAM, exam),
  // [c] 删除考试(级联删除成绩) — UI 层应二次确认
  deleteExam: (examId: string) => ipcRenderer.invoke(IPC.IPC_ACADEMIC_DELETE_EXAM, examId),
  // [r] 读取学生全部成绩
  getGrades: (studentName: string) => ipcRenderer.invoke(IPC.IPC_ACADEMIC_GET_GRADES, studentName),
  // [w] 批量设置成绩
  batchSetGrades: (records: unknown) =>
    ipcRenderer.invoke(IPC.IPC_ACADEMIC_BATCH_SET_GRADES, records),
  // [r] 读取班级成绩(参数: studentNames[], examId, subjectId?)
  getClassGrades: (studentNames: string[], examId: string, subjectId?: string) =>
    ipcRenderer.invoke(IPC.IPC_ACADEMIC_GET_CLASS_GRADES, studentNames, examId, subjectId),
}
