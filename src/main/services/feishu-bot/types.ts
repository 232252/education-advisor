// =============================================================
// feishu-bot/types — 飞书机器人服务的公共类型
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

export type BotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface BotStatusInfo {
  status: BotStatus
  appId?: string
  /** 上次错误信息(status === 'error' 时有值) */
  error?: string
  /** 已连接的时长(ms 时间戳),status === 'connected' 时有值 */
  connectedAt?: number
  /** 正在处理的消息数(诊断用) */
  processingCount?: number
  /** 排队中 + 处理中的消息总数(诊断用) */
  pendingCount?: number
}

/**
 * im.message.receive_v1 事件的数据结构(内联定义,避免依赖 SDK 内部命名空间)。
 * 仅声明本模块用到的字段。
 */
export interface FeishuMessageEvent {
  message?: {
    message_id: string
    chat_id: string
    chat_type: string // 'p2p' | 'group'
    message_type: string
    content: string // JSON 字符串,如 {"text":"hello"}
    mentions?: Array<{ key: string; name: string; id?: Record<string, string | undefined> }>
  }
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string }
    sender_type?: string
  }
}
