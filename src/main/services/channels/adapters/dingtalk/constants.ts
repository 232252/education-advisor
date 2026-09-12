// =============================================================
// adapters/dingtalk/constants — 钉钉平台常量
// 事实来源(2026-09-12 核验):
//   - Stream 协议: open-dingtalk developerpedia stream/protocol
//   - AI 卡片: 官方连接器 DingTalk-Real-AI/dingtalk-openclaw-connector
//     src/services/messaging/card.ts(公共模板 ID + 请求体逐字段核对)
//   - 频控: 卡片 API 官方约 40 QPS,保守取 20(与官方连接器一致)
// =============================================================

/** 新版 API 域(卡片/机器人收发/网关) */
export const DINGTALK_API_BASE = 'https://api.dingtalk.com'

/** 机器人消息 Stream 订阅 topic(群聊需 @机器人,单聊直发) */
export const DINGTALK_BOT_TOPIC = '/v1.0/im/bot/messages/get'

/**
 * 官方公共 AI 卡片模板 — 所有机器人可复用,用户无需自建模板
 * (DingTalk-Real-AI/dingtalk-openclaw-connector #540 确认为官方公共模板)。
 * settings.channels.dingtalk.cardTemplateId 可覆盖。
 */
export const DEFAULT_AI_CARD_TEMPLATE_ID = '02fcf2f4-5e02-4a85-b672-46d1f715543e.schema'

/** AI 卡片流控状态(flowStatus) */
export const AI_CARD_STATUS = {
  /** 思考中 */
  PROCESSING: '1',
  /** 输入中(打字机) */
  INPUTING: '2',
  /** 已完成 */
  FINISHED: '3',
  /** 执行中 */
  EXECUTING: '4',
  /** 失败 */
  FAILED: '5',
} as const

/** 流式卡片更新节流间隔(与飞书 CardKit 同档: 900ms) */
export const STREAM_UPDATE_INTERVAL_MS = 900

/** 卡片 API 保守限速(官方约 40 QPS;多会话并发时按 20 补令牌) */
export const CARD_API_MAX_QPS = 20

/** 遇 QpsLimit(403) 后的退避时长 */
export const QPS_BACKOFF_MS = 2_000

/** 守护重连: 最大尝试次数(与飞书引擎一致) */
export const MAX_GUARD_ATTEMPTS = 8

/** 守护重连退避基数(5s→10s→…封顶 60s) */
export const GUARD_BACKOFF_BASE_MS = 5_000

/** 守护重连退避封顶 */
export const GUARD_BACKOFF_MAX_MS = 60_000

/** ws 层保活间隔(服务端静默 10s 断连;25s 内有 ws ping 即可穿透常见 NAT) */
export const WS_KEEPALIVE_INTERVAL_MS = 25_000

/** 接收文件保存目录名(userData 下) */
export const RECEIVED_FILES_DIR_NAME = 'dingtalk-files'
