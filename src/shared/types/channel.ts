// =============================================================
// Channel(消息频道)共享类型 — 主进程/渲染进程共用
// 频道化架构的实施基准见 docs/plans/2026-09-12-channel-architecture-implementation.md §3.3
// 分层: 本文件只放"线上/数据"形状(消息信封/能力位/状态/manifest),
// 运行时接口(ChannelAdapter/RuntimeContext)在 main/services/channels/types.ts。
// =============================================================

import type { AgentRunSource } from './agent'

/** 渠道如何收到平台消息(决定桌面端能否直连,UI 前置声明部署约束) */
export type ChannelReceiveMode = 'ws' | 'polling' | 'imap-idle' | 'webhook' | 'relay-ws' | 'mqtt' | 'sip'

/**
 * 流式输出形态(能力位核心):
 *   - 'none'           邮件/微信公众号/QQ — 只能一次性回复
 *   - 'card-stream'    飞书 CardKit / 钉钉 AI 卡片 — 先发卡片再独立 update(全量文本)
 *   - 'respond-stream' 企微智能机器人 — respond 命令内嵌 stream.id 刷新(10 分钟硬窗口)
 *   - 'edit-message'   Telegram editMessageText / Slack chat.update — 降频编辑已发消息
 */
export type StreamingKind = 'none' | 'card-stream' | 'respond-stream' | 'edit-message'

/** 能力位: Bridge 据此自适应输出策略(节流档位/降级链/超长分段/推送前置检查) */
export interface ChannelCapabilities {
  receivesVia: ChannelReceiveMode
  streamingKind: StreamingKind
  /** 是否支持富卡片(飞书/钉钉 true;Telegram InlineKeyboard 不算) */
  canSendCard: boolean
  /** 单条文本上限;超长由 runtime 统一分段。null = 平台未明示 */
  maxTextLength: number | null
  /** 被动回复有效期(企微 24h、QQ 群 5min);null = 不限 */
  replyWindowMs: number | null
  /** 流式必须完成的硬窗口(企微 10min);null = 不限 */
  streamWindowMs: number | null
  /** 主动推送约束(企微需用户先发过消息) */
  pushPolicy: 'free' | 'require-prior-message' | 'quota'
  /** 是否能接收文件/图片附件 */
  receivesFiles: boolean
}

/** 入站附件引用(未下载;Bridge 经 adapter.fetchAttachment 按需取) */
export interface InboundAttachment {
  kind: 'file' | 'image' | 'video' | 'audio'
  /** 飞书 file_key / 钉钉 downloadCode / Telegram file_id */
  fileKey: string
  fileName?: string
}

/** 统一入站信封(各 Adapter 把平台事件归一化成这个形状) */
export interface InboundMessage {
  /** 频道类型 'feishu' | 'dingtalk' | ... */
  channel: string
  /** 去重键: 飞书 message_id / 钉钉 headers.messageId / 邮件 Message-ID */
  providerMessageId: string
  providerEventId?: string
  chat: { id: string; type: 'p2p' | 'group' }
  sender: { id: string; name?: string }
  text: string
  attachments: InboundAttachment[]
  /** 平台原始事件(诊断用) */
  raw?: unknown
  receivedAt: number
}

/** 流式出站会话 — streaming-card.ts 事实抽象的提升(update/finalize/fail 均幂等) */
export interface ReplySession {
  /** 全量文本(飞书 CardKit/钉钉 streamingUpdate 语义;新文本以旧文本为前缀) */
  update(fullText: string): Promise<void>
  /** 终稿收尾(关流式态/换摘要),之后 update 不再生效 */
  finalize(finalText: string): Promise<void>
  /** 错误收尾(卡片/消息上呈现错误文案) */
  fail(errorText: string): Promise<void>
}

/** 渠道运行状态(五态;enabled 开关与运行状态是两个正交维度) */
export type ChannelRunStatus =
  | 'not-configured' // 未配置(缺必填凭证)
  | 'disabled' // 已配置但开关关闭
  | 'connecting' // 连接中
  | 'connected' // 运行中
  | 'error' // 错误(detail 携带原因)

/** 渠道状态信息(合并原 BotStatusInfo/FeishuBotStatusInfo 两个重复定义) */
export interface ChannelStatusInfo {
  channel: string
  status: ChannelRunStatus
  /** 最近错误/降级原因,如「流式卡片无权限,已降级纯文本」 */
  detail?: string
  /** 降级子态(阶段 0 降级链:CardKit 不可用时纯文本续命) */
  degraded?: boolean
  connectedAt?: number
  /** 最近成功收到消息的时间戳 */
  lastMessageAt?: number
  /** 最近错误时间戳 */
  lastErrorAt?: number
  /** 当前重连尝试次数(0=稳定) */
  reconnectAttempt?: number
  processingCount: number
  pendingCount: number
}

/** 出站媒体引用(QQ /files 等;本地路径或公网 URL) */
export interface OutboundMediaRef {
  kind: 'image' | 'file' | 'video' | 'audio'
  /** 本地绝对路径或 http(s) URL */
  source: string
  fileName?: string
}

/** 出站内容(sendReply/push;流式场景用 createReplySession) */
export type OutboundContent =
  | { kind: 'text'; text: string; media?: OutboundMediaRef[] }
  | { kind: 'markdown'; text: string; media?: OutboundMediaRef[] }

/** 主动推送目标(cron 通知/告警);adapter 按能力位自查 pushPolicy 前置条件 */
export interface PushTarget {
  chatId: string
  senderId?: string
}

/** 附件下载结果 */
export type ChannelFetchedAttachment =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string }

/** 配置校验结果(测试连接 = validateConfig + 轻量探活) */
export type ChannelConfigValidation =
  | { ok: true }
  | { ok: false; message: string; field?: string }

// ===========================================================
// Manifest — 渠道自描述(驱动连接中心卡片/表单/指引,LangBot 模式)
// ===========================================================

/** 表单字段声明(渲染层 SchemaForm 据此生成配置 UI) */
export interface ConfigField {
  name: string
  label: string
  description?: string
  type: 'string' | 'secret' | 'select' | 'boolean' | 'number'
  options?: { value: string; label: string }[]
  default?: unknown
  required?: boolean
  /** 格式校验(如飞书 appId '^cli_[0-9a-fA-F]{16}$') */
  pattern?: string
  /** 条件显隐(如企微私有化地址仅长连接模式显示) */
  showIf?: { field: string; equals: unknown }
  /** 字段级文档外链(对应指引面板) */
  helpLink?: string
}

/** 平台侧操作清单(建应用/开权限/发布) — 渲染为 GuidePanel */
export interface ChannelSetupGuide {
  title: string
  steps: string[]
}

export interface ChannelManifest {
  /** 渠道类型 id(= settings.channels.<id> 的键;kebab-case) */
  id: string
  label: string
  description: string
  /** 渲染层图标标识 */
  icon: string
  capabilities: ChannelCapabilities
  configSchema: ConfigField[]
  setupGuide?: ChannelSetupGuide
  /** Beta 徽标(WorkBuddy「集成 BETA」模式) */
  beta?: boolean
  /** 即将支持: 渲染占位卡,不注册运行时 */
  comingSoon?: boolean
  /** 支持的登录方式(扫码型渠道声明 'qr';凭证型省略或仅 'credentials') */
  loginKinds?: Array<'credentials' | 'qr'>
  /** i18n key for fixed limitation banner (QQ 弱主动 / 微信偏私聊) */
  limitationBannerKey?: string
  /** 目录分组(「更多」Drawer 网格) */
  category?:
    | 'enterprise-im'
    | 'consumer-im'
    | 'assistant'
    | 'iot'
    | 'voice'
    | 'overseas'
    | 'local'
    | 'email'
  /** 区域策略: domestic 优先展示 */
  region?: 'domestic' | 'foreign' | 'neutral'
  /** 排序权重;越小越靠前。缺省按注册序 */
  priority?: number
  /** 外链到平台开放文档 */
  docsUrl?: string
  /** 映射 QwenPaw 配置键(如 weixin → wechat) */
  qwenpawKey?: string
  /** 目录展示但不可启用(合规等);有值时 UI 标「不支持」 */
  unsupportedReason?: string
  /**
   * 目录生命周期(与 comingSoon 并存时以本字段为准展示态):
   * enabled=可配置; comingSoon=即将推出; later=海外/稍后; unsupported=合规禁止
   */
  catalogStatus?: 'enabled' | 'comingSoon' | 'later' | 'unsupported'
}

/** 渠道实例摘要(channels:list IPC 返回,渲染卡片墙) */
export interface ChannelInstanceInfo {
  manifest: ChannelManifest
  /** 派生: 是否已配置必填字段(含 keystore secret) */
  configured: boolean
  /** settings 中的启用开关(与运行状态正交) */
  enabled: boolean
  status: ChannelStatusInfo
}

/** 渠道运行来源(与 AgentRunSource 对齐:渠道触发的 Agent 运行标 'channel') */
export type { AgentRunSource }

