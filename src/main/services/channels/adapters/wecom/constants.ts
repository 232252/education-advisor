// =============================================================
// adapters/wecom/constants — 企微智能机器人平台常量
// 事实来源(2026-09-12 核验):
//   - 官方 SDK @wecom/aibot-node-sdk@1.0.7 dist 源码逐字段核对
//   - 调研 docs/research/2026-09-12-channel-connector-catalog.md §2.2
// =============================================================

/** 长连接网关(桌面直连,免公网) */
export const WECOM_WS_URL = 'wss://openws.work.weixin.qq.com'

/** 协议命令字 */
export const WECOM_CMD = {
  SUBSCRIBE: 'aibot_subscribe',
  HEARTBEAT: 'ping',
  RESPONSE: 'aibot_respond_msg',
  SEND_MSG: 'aibot_send_msg',
  CALLBACK: 'aibot_msg_callback',
  EVENT_CALLBACK: 'aibot_event_callback',
} as const

/** 心跳间隔(官方建议 30s;SDK 默认 30000) */
export const HEARTBEAT_INTERVAL_MS = 30_000

/** 连续心跳未确认次数上限(超过判死线,SDK 默认 2) */
export const MAX_MISSED_PONG = 2

/** 回复窗口: 回调后 24h 内可 respond(被动回复有效期) */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 流式硬窗口: 首次发送起 10 分钟内必须 finish(官方约束)。
 * Bridge 侧提前 30s 强制收尾,防 Agent 长任务打爆窗口后无法回复。
 */
export const STREAM_WINDOW_MS = 10 * 60 * 1000
export const STREAM_WINDOW_GUARD_MS = 30_000

/** 守护重连(网络断线场景;认证失败另有计数) */
export const MAX_GUARD_ATTEMPTS = 8
export const GUARD_BACKOFF_BASE_MS = 5_000
export const GUARD_BACKOFF_MAX_MS = 60_000

/** 认证失败重试上限(SDK 默认行为:连续认证失败放弃,交用户检查凭证) */
export const MAX_AUTH_FAILURE_ATTEMPTS = 3

/** 流式回复节流(与飞书/钉钉同档 900ms;单会话 30 条/分钟频控余量充足) */
export const STREAM_UPDATE_INTERVAL_MS = 900

/** 订阅响应等待上限 */
export const AUTH_TIMEOUT_MS = 10_000

/** 接收文件保存目录名(userData 下) */
export const RECEIVED_FILES_DIR_NAME = 'wecom-files'
