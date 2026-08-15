// =============================================================
// Students 模块共享类型 — 从 StudentsPage 提取
// =============================================================

// Electron 文件对话框返回类型
export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface SaveDialogResult {
  canceled: boolean
  filePath: string
}

// 自定义确认对话框状态（替代 window.confirm）
export interface ConfirmState {
  open: boolean
  message: string
  onConfirm: () => void
  variant?: 'default' | 'danger'
}
