// =============================================================
// IPC API 类型 — 连接中心里的 dsh-im 面板
// =============================================================

export interface DshImBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DshImShowResult {
  ok: boolean
  error?: string
}

/** 插件中心用的接入状态。true 表示安装戳和当前插件版本一致。 */
export interface EducationPluginInstall {
  /** 连接中心 web profile 上的 dsh-im */
  im: boolean
  /** 教师对话和连接中心都装上了花名册 */
  roster: boolean
  grades: boolean
  grading: boolean
  /** 操行工具（eaa-tools） */
  conduct: boolean
}

export interface DshImAPI {
  /**
   * 在主窗口里按这块区域贴上 dsh web。
   * 登录令牌留在主进程：dsh 的会话 cookie 是 SameSite=Strict，跨源 iframe 带不走。
   */
  show: (bounds: DshImBounds) => Promise<DshImShowResult>
  hide: () => Promise<void>
  /** 子视图里按下 Esc 时通知面板关闭 */
  onClosed: (callback: () => void) => () => void
  /** 读本机 sdk / web 安装戳，不触发安装 */
  pluginInstall: () => Promise<EducationPluginInstall>
}
