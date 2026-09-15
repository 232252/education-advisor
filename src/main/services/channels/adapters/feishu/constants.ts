// =============================================================
// adapters/feishu/constants — 飞书渠道模块常量
// (M3 从 feishu-bot/constants.ts 搬入,值不变;原文件改为 re-export 壳)
// 通用件常量(合并窗口/去重容量等)已随模块上提 channels/runtime,
// 此处保留飞书平台值与渠道装配引用。
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

// ------- 阶段 0(调研报告 docs/research/2026-09-12 §5) -------
/** 同一会话连发消息的合并窗口(ms) — 与 channels/runtime/chat-queue 默认值一致(历史引用保留) */
export const CHAT_MERGE_WINDOW_MS = 2000
/** 每个会话记住的最近文件条数 — 与 channels/runtime/recent-files 默认值一致(历史引用保留) */
export const RECENT_FILES_PER_CHAT = 5
/** 会话最近文件的有效期(ms) — 与 channels/runtime/recent-files 默认值一致(历史引用保留) */
export const RECENT_FILE_TTL_MS = 30 * 60 * 1000
/** 流式卡片文本更新节流间隔(官方上限 10 次/秒,取保守值兼顾免费版 API 月额度) */
export const STREAM_UPDATE_INTERVAL_MS = 900
/** 卡片内容上限 30KB,按序列化后实际体积预留余量 */
export const STREAM_CARD_TEXT_LIMIT = 28_000
/** 接收文件在 userData 下的保存目录名 */
export const RECEIVED_FILES_DIR_NAME = 'feishu-files'
/** 接收文件保留天数(过期清理) */
export const RECEIVED_FILE_RETENTION_DAYS = 7
/** 单个接收文件大小上限(100MB) */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
/** 出站上传文件/图片上限(飞书官方 30MB,与 QwenPaw 一致) */
export const FEISHU_FILE_MAX_BYTES = 30 * 1024 * 1024
