// =============================================================
// 飞书长连接机器人状态类型
// =============================================================

export type FeishuBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface FeishuBotStatusInfo {
  status: FeishuBotStatus
  appId?: string
  /** 上次错误信息(status === 'error' 时有值) */
  error?: string
  /** 已连接的时间戳(ms),status === 'connected' 时有值 */
  connectedAt?: number
  /** 正在处理的消息数(诊断用) */
  processingCount?: number
}
