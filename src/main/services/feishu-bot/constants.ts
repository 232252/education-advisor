// =============================================================
// feishu-bot/constants — 飞书机器人服务的模块级常量
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

export const DEFAULT_AGENT_ID = 'main'
/** 飞书单条文本消息内容上限(字符),超出截断 */
export const REPLY_CHAR_LIMIT = 4000
/** 飞书 App ID 格式(SDK 内部也按此校验,但仅打日志不抛错,会导致"假连接"永远停在连接中) */
export const APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/
/** 待处理消息(排队中 + 处理中)上限,超出回"繁忙"并丢弃,防止队列无限增长 */
export const MAX_PENDING_MESSAGES = 16
/** 已处理 message_id 去重缓存上限(飞书至少一次投递,ack 超时/网络抖动会重投) */
export const DEDUP_CACHE_SIZE = 500
/** 守护重启最大连续尝试次数,超过则标记 error 等待人工介入 */
export const MAX_GUARD_ATTEMPTS = 8
