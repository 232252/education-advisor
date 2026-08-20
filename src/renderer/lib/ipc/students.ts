// =============================================================
// IPC API 类型 — 学生 Excel 批量导入域 (window.api.students)
// 方法名与 preload 脚本一一对应,不可改动
// =============================================================

import type {
  StudentImportParams,
  StudentImportPreview,
  StudentImportProgress,
  StudentImportResult,
  StudentImportTemplateResult,
} from '@shared/types'

export interface StudentsAPI {
  parseExcel: (filePath: string) => Promise<StudentImportPreview>
  importExcel: (params: StudentImportParams) => Promise<StudentImportResult>
  importTemplate: (filePath: string) => Promise<StudentImportTemplateResult>
  /** 导入进度事件订阅，返回取消订阅函数。data: { current, total, imported, lastName } */
  onImportProgress: (callback: (data: StudentImportProgress) => void) => () => void
}
