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

/** 系统打印机信息(套打静默连打选设备用) */
export interface PrinterInfo {
  /** OS 层打印机名(静默连打 deviceName 用这个) */
  name: string
  description: string
  /** 打印预览里显示的名字 */
  displayName: string
}

export interface SysAPI {
  openDialog: (options: unknown) => Promise<unknown>
  saveDialog: (options: unknown) => Promise<unknown>
  /** 应用版本号(R2-16: 运行时读取 package.json version) */
  getVersion: () => Promise<string>
  /** 获取系统路径(入参为 Electron 固定枚举;非法名返回失败信封) */
  getPath: (name: string) => Promise<string | { success: false; error: string }>
  /** 弹出更新对话框 */
  showUpdateDialog: () => Promise<{ success: boolean; error?: string }>
  checkUpdate: () => Promise<CheckUpdateResult>
  /** 下载更新 (M31: electron-updater;进度经 onUpdateProgress 推送) */
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  /** 重启并安装已下载的更新;portable 版返回 portable=true 提示手动替换 */
  installUpdate: () => Promise<{ success: boolean; portable: boolean; error?: string }>
  /** 订阅更新下载进度 (返回取消订阅函数) */
  onUpdateProgress: (callback: (info: UpdateProgressInfo) => void) => () => void
  readFile: (
    filePath: string,
    /** P0-3: metaOnly=true 只取元信息(名称/大小/MIME),不读内容 — 二进制附件用 */
    opts?: { metaOnly?: boolean },
  ) => Promise<{
    success: boolean
    /** 成功时回传的源路径(失败信封不含;渲染端用本地 filePath 变量) */
    path?: string
    name?: string
    size?: number
    mimeType?: string
    encoding?: 'utf-8' | 'base64'
    content?: string
    error?: string
  }>
  /** 重启应用(备份恢复后调用;成功后进程立即退出) */
  restartApp: () => Promise<{ success: boolean; error?: string }>
  /** 出厂重置：清空班级/学生/对话/成绩/记忆/模型密钥/设置。成功后应 relaunch */
  factoryReset: () => Promise<{ success: boolean; error?: string }>
  /** 本机 WebUI 状态 */
  getWebUiStatus: () => Promise<import('@shared/types').WebUiStatus>
  /** 用系统浏览器打开当前 WebUI 地址 */
  openWebUi: () => Promise<{ success: boolean; url?: string; error?: string }>
  /** 重新生成 256-bit 访问令牌并立即生效 */
  regenerateWebUiToken: () => Promise<{ success: boolean; error?: string }>
  // [r] 系统打印机清单(套打静默连打选设备)
  listPrinters: () => Promise<{ success: boolean; data?: PrinterInfo[]; error?: string }>
}
