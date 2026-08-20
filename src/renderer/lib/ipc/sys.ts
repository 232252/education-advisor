// =============================================================
// IPC API 类型 — 系统域 (window.api.sys)
// =============================================================

/** 检查更新结果 (sys:check-update) */
export interface CheckUpdateResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
  message: string
  /** portable 版不支持自动安装,UI 提示手动替换 */
  portable: boolean
}

/** 更新下载进度载荷 (sys:update-progress 推送) */
export interface UpdateProgressInfo {
  /** downloading / downloaded / error */
  status: 'downloading' | 'downloaded' | 'error'
  /** 下载百分比 0-100 */
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
  version: string
  message: string
}

export interface SysAPI {
  openDialog: (options: unknown) => Promise<unknown>
  saveDialog: (options: unknown) => Promise<unknown>
  getPath: (name: string) => Promise<string>
  checkUpdate: () => Promise<CheckUpdateResult>
  showUpdateDialog: () => Promise<{ success: boolean }>
  /** 下载更新 (M31: electron-updater;进度经 onUpdateProgress 推送) */
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  /** 重启并安装已下载的更新;portable 版返回 portable=true 提示手动替换 */
  installUpdate: () => Promise<{ success: boolean; portable: boolean; error?: string }>
  /** 订阅更新下载进度 (返回取消订阅函数) */
  onUpdateProgress: (callback: (info: UpdateProgressInfo) => void) => () => void
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
