// =============================================================
// adapters/weixin/constants — 微信 iLink Bot 常量
// 协议真源: https://ilinkai.weixin.qq.com (官方 HTTP/JSON,无第三方 SDK)
// =============================================================

export const WEIXIN_MANIFEST_ID = 'weixin'

/** 默认 iLink API 基址 */
export const WEIXIN_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'

/** 扫码页回退(官方 liteapp;qrcode 参数来自 get_bot_qrcode) */
export const WEIXIN_QR_SCAN_FALLBACK =
  'https://liteapp.weixin.qq.com/q/7GiQu1'

/** bot_type=3: ClawBot / iLink 个人微信 Bot */
export const WEIXIN_BOT_TYPE = 3

/** 渠道版本串(getupdates/sendmessage base_info) */
export const WEIXIN_CHANNEL_VERSION = '2.0.1'

/** 长轮询客户端超时(服务端 hold ~35s) */
export const WEIXIN_GETUPDATES_TIMEOUT_MS = 45_000

/** 普通 HTTP 超时 */
export const WEIXIN_DEFAULT_TIMEOUT_MS = 15_000

/** QR 状态轮询超时(服务端可 hold ~30s) */
export const WEIXIN_QR_STATUS_TIMEOUT_MS = 60_000

/** 用户→Bot 消息类型 */
export const WEIXIN_MSG_TYPE_USER = 1
/** Bot→用户 消息类型 */
export const WEIXIN_MSG_TYPE_BOT = 2
/** 消息完成态 */
export const WEIXIN_MSG_STATE_FINISH = 2
/** 文本 item type */
export const WEIXIN_ITEM_TYPE_TEXT = 1

export const RECEIVED_FILES_DIR_NAME = 'channels/weixin/files'
