// =============================================================
// yuanbao/constants — gateway URLs & protocol knobs (QwenPaw parity)
// =============================================================

export const DEFAULT_WS_URL = 'wss://bot-wss.yuanbao.tencent.com/wss/connection'
export const DEFAULT_API_DOMAIN = 'https://bot.yuanbao.tencent.com'
export const SIGN_TOKEN_PATH = '/api/v5/robotLogic/sign-token'
export const UPLOAD_INFO_PATH = '/api/resource/genUploadInfo'
export const DOWNLOAD_INFO_PATH = '/api/resource/v1/download'
export const MAX_UPLOAD_MB = 20

export const RETRYABLE_SIGN_CODE = 10099
export const SIGN_MAX_RETRIES = 3
export const SIGN_RETRY_DELAY_MS = 1_000
export const TOKEN_REFRESH_MARGIN_MS = 300_000

export const HEARTBEAT_INTERVAL_MS = 5_000
export const HEARTBEAT_TIMEOUT_THRESHOLD = 2
export const CONNECTION_TIMEOUT_MS = 15_000
export const SEND_TIMEOUT_MS = 30_000
export const TEXT_CHUNK_LIMIT = 2800

export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const
export const MAX_RECONNECT_ATTEMPTS = 100

export const NO_RECONNECT_CLOSE_CODES = new Set([4012, 4013, 4014, 4018, 4019, 4021])
export const AUTH_FAILED_CODES = new Set([41103, 41104, 41108])
export const AUTH_ALREADY_CODE = 41101

export const HEARTBEAT_RUNNING = 1
export const HEARTBEAT_FINISH = 2

export const CMD_TYPE_REQUEST = 0
export const CMD_TYPE_RESPONSE = 1
export const CMD_TYPE_PUSH = 2
export const CMD_TYPE_PUSH_ACK = 3

export const CMD_AUTH_BIND = 'auth-bind'
export const CMD_PING = 'ping'
export const CMD_KICKOUT = 'kickout'

export const MODULE_CONN_ACCESS = 'conn_access'
export const MODULE_BIZ = 'yuanbao_openclaw_proxy'

export const BIZ_CMD_SEND_C2C = 'send_c2c_message'
export const BIZ_CMD_SEND_GROUP = 'send_group_message'
export const BIZ_CMD_PRIVATE_HB = 'send_private_heartbeat'
export const BIZ_CMD_GROUP_HB = 'send_group_heartbeat'

export const CONN_MSG = 'trpc.yuanbao.conn_common.ConnMsg'
export const AUTH_BIND_REQ = 'trpc.yuanbao.conn_common.AuthBindReq'
export const AUTH_BIND_RSP = 'trpc.yuanbao.conn_common.AuthBindRsp'
export const PING_REQ = 'trpc.yuanbao.conn_common.PingReq'
export const PING_RSP = 'trpc.yuanbao.conn_common.PingRsp'
export const KICKOUT_MSG = 'trpc.yuanbao.conn_common.KickoutMsg'

const BIZ_PKG = 'trpc.yuanbao.yuanbao_conn.yuanbao_openclaw_proxy'
export const INBOUND_MSG_PUSH = `${BIZ_PKG}.InboundMessagePush`
export const SEND_C2C_REQ = `${BIZ_PKG}.SendC2CMessageReq`
export const SEND_C2C_RSP = `${BIZ_PKG}.SendC2CMessageRsp`
export const SEND_GROUP_REQ = `${BIZ_PKG}.SendGroupMessageReq`
export const SEND_GROUP_RSP = `${BIZ_PKG}.SendGroupMessageRsp`
export const SEND_PRIVATE_HB_REQ = `${BIZ_PKG}.SendPrivateHeartbeatReq`
export const SEND_GROUP_HB_REQ = `${BIZ_PKG}.SendGroupHeartbeatReq`
