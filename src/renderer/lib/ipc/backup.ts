// =============================================================
// IPC API 类型 — 数据备份/恢复域 (window.api.backup)
// =============================================================

export interface AutoBackupInfo {
  /** 备份文件名(位于 {userData}/backups/ 下) */
  fileName: string
  sizeBytes: number
  /** 创建时间(epoch ms,文件 mtime) */
  createdAt: number
  kind: 'auto' | 'pre-restore'
}

export interface BackupAPI {
  /** 弹保存对话框 → 打包核心数据为 zip */
  createDialog: () => Promise<{
    success: boolean
    /** 用户取消对话框 */
    canceled?: boolean
    path?: string
    files?: number
    bytes?: number
    error?: string
  }>
  /** 弹选择对话框 → 校验 → 恢复前安全备份 → 替换数据文件(危险操作,UI 需二次确认) */
  restoreDialog: () => Promise<{
    success: boolean
    canceled?: boolean
    /** 成功恢复后必须重启应用 */
    requiresRestart?: boolean
    restoredFiles?: number
    safetyBackupPath?: string
    error?: string
  }>
  /** 列出自动/安全备份 */
  listAuto: () => Promise<{ success: boolean; data?: AutoBackupInfo[]; error?: string }>
  /** 删除一个备份文件 */
  deleteAuto: (fileName: string) => Promise<{ success: boolean; error?: string }>
}
