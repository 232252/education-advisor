// =============================================================
// Preload API — 学生 Excel 批量导入域(M30)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type {
  StudentImportParams,
  StudentImportPreview,
  StudentImportProgress,
  StudentImportResult,
  StudentImportTemplateResult,
} from '@shared/types'
import { ipcRenderer } from 'electron'

export const studentsApi = {
  // [r] 解析 Excel 文件返回预览(行数据 + 重名/已存在冲突检测)
  parseExcel: (filePath: string) =>
    ipcRenderer.invoke(IPC.IPC_STUDENTS_PARSE_EXCEL, filePath) as Promise<StudentImportPreview>,
  // [w] 预览确认后逐条 add-student 批量导入
  importExcel: (params: StudentImportParams) =>
    ipcRenderer.invoke(IPC.IPC_STUDENTS_IMPORT_EXCEL, params) as Promise<StudentImportResult>,
  // [w] 生成 Excel 导入模板到指定路径(路径来自 sys:save-dialog)
  importTemplate: (filePath: string) =>
    ipcRenderer.invoke(
      IPC.IPC_STUDENTS_IMPORT_TEMPLATE,
      filePath,
    ) as Promise<StudentImportTemplateResult>,
  // [event] 导入进度(主进程串行 spawn 较慢,实时推送 current/total/imported/lastName)
  onImportProgress: (callback: (data: StudentImportProgress) => void) => {
    const handler = (_e: unknown, data: StudentImportProgress) => callback(data)
    ipcRenderer.on(IPC.IPC_STUDENTS_IMPORT_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.IPC_STUDENTS_IMPORT_PROGRESS, handler)
    }
  },
}
