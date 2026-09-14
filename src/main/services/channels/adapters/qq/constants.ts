// =============================================================
// adapters/qq/constants — QQ 官方 Bot API 常量
// 协议真源: https://bot.q.qq.com/wiki/develop/api-v2/
// =============================================================

export const QQ_MANIFEST_ID = 'qq'

export const QQ_DEFAULT_API_BASE = 'https://api.sgroup.qq.com'
export const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
export const QQ_PORTAL_HOST = 'q.qq.com'
export const QQ_CREATE_BIND_PATH = '/lite/create_bind_task'
export const QQ_POLL_BIND_PATH = '/lite/poll_bind_result'
/** 腾讯门户前端路径名含 openclaw,仅为页面命名,不要求安装 OpenClaw */
export const QQ_BIND_FRONTEND_PATH = '/qqbot/openclaw/connect.html'

export const QQ_OP_DISPATCH = 0
export const QQ_OP_HEARTBEAT = 1
export const QQ_OP_IDENTIFY = 2
export const QQ_OP_RESUME = 6
export const QQ_OP_RECONNECT = 7
export const QQ_OP_INVALID_SESSION = 9
export const QQ_OP_HELLO = 10
export const QQ_OP_HEARTBEAT_ACK = 11

/** 群+C2C 等公共意图位(与官方 wiki / 社区实现对齐) */
export const QQ_INTENT_GROUP_AND_C2C = 1 << 25
export const QQ_INTENT_PUBLIC_GUILD_MESSAGES = 1 << 30
export const QQ_INTENT_DIRECT_MESSAGE = 1 << 12

/** 群被动回复窗口约 5 分钟 */
export const QQ_GROUP_REPLY_WINDOW_MS = 5 * 60 * 1000

export const RECEIVED_FILES_DIR_NAME = 'channels/qq/files'

/** 扫码 onboard 的 source 标识(门户统计用) */
export const QQ_BIND_SOURCE = 'education-advisor'

/** Gateway 断线重连退避(秒级对齐官方实践) */
export const QQ_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const

