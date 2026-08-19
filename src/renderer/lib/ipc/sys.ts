// =============================================================
// IPC API 类型 — 系统域 (window.api.sys)
// =============================================================

export interface SysAPI {
  openDialog: (options: unknown) => Promise<unknown>
  saveDialog: (options: unknown) => Promise<unknown>
  getPath: (name: string) => Promise<string>
  checkUpdate: () => Promise<{
    hasUpdate: boolean
    currentVersion: string
    latestVersion: string
    releaseUrl: string
    releaseNotes: string
    message: string
  }>
  showUpdateDialog: () => Promise<{ success: boolean }>
  readFile: (filePath: string) => Promise<{
    success: boolean
    path: string
    name?: string
    size?: number
    mimeType?: string
    encoding?: 'utf-8' | 'base64'
    content?: string
    error?: string
  }>
  /** 重启应用(备份恢复后调用;成功后进程立即退出) */
  restartApp: () => Promise<{ success: boolean; error?: string }>
}
