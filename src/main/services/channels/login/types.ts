// =============================================================
// channels/login/types — 扫码登录会话共享形状(主进程 + IPC)
// =============================================================

export type ChannelLoginStatus =
  | 'pending'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'error'
  | 'cancelled'

export interface ChannelLoginBeginResult {
  loginId: string
  channelId: string
  /** 供 QrCode 组件渲染的扫码内容(URL 或原始串) */
  qrContent: string
  expiresAt: number
}

export interface ChannelLoginPollResult {
  status: ChannelLoginStatus
  detail?: string
  /** confirmed 时可选回显(不含 secret 明文) */
  bound?: { appId?: string; baseUrl?: string }
}
