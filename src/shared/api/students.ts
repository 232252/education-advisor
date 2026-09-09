// =============================================================
// IPC API 类型 — 学生 Excel 批量导入域 (window.api.students)
// 单一来源: preload 实现按此接口注解,契约由编译期强制
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
