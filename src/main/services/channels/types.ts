// =============================================================
// channels/types — 频道运行时契约(仅主进程)
// 数据形状(信封/能力位/manifest/状态)在 @shared/types/channel,
// 这里只放 ChannelAdapter/ChannelRuntimeContext 等运行时接口。
// 基准: docs/plans/2026-09-12-channel-architecture-implementation.md §3.3
// =============================================================

import type {
  ChannelConfigValidation,
  ChannelFetchedAttachment,
  ChannelManifest,
  ChannelStatusInfo,
  InboundAttachment,
  InboundMessage,
  OutboundContent,
  PushTarget,
  ReplySession,
} from '@shared/types'

/**
 * Adapter 运行时上下文(由 ChannelManager 组装注入):
 * 凭证经 getSecret 从 keystore 读取(不接触 settings 对象),
 * 入站消息经 bridge.onMessage 上交(runtime 去重/排队在此之后)。
 */
export interface ChannelRuntimeContext {
  /** manifest.configSchema 声明的非 secret 字段(已解析的 settings 值) */
  config: Record<string, unknown>
  /** keystore 读取(如 'appSecret');无值返回 null */
  getSecret(name: string): Promise<string | null>
  bridge: {
    /** 归一化后的入站消息上交 Bridge(队列/合并/Agent 调度在 Bridge) */
    onMessage(msg: InboundMessage): void
    /** 状态上报(→ ChannelManager 聚合 → IPC fanout renderer+WebUI) */
    onStatus(partial: Omit<ChannelStatusInfo, 'channel' | 'processingCount' | 'pendingCount'>): void
  }
  /** 渠道专属文件目录(userData/channels/<id>/files) */
  filesDir: string
  /** 主窗口引用(Agent 状态推送到渲染层;无窗口场景为 null,渠道侧桥接不依赖它) */
  getWin(): import('electron').BrowserWindow | null
}

/**
 * 渠道适配器 — 每渠道一个实现(飞书是第一个,M3 迁入)。
 * 职责边界: 只管"连接 + 平台 API + 消息归一化";
 * 队列/合并/Agent 调度/长文本分段在 runtime+Bridge,Adapter 不重复实现。
 */
export interface ChannelAdapter {
  readonly id: string
  readonly manifest: ChannelManifest

  /**
   * 凭证/格式预检(不建连接、不发消息):
   * 用于「测试连接」与 start 前置检查,失败应带可读 message(+字段定位)。
   */
  validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation>

  /** 建立连接(WS 长连接/长轮询等);抛错 = 启动失败,Manager 记 error 状态 */
  connect(ctx: ChannelRuntimeContext): Promise<void>

  /** 与 connect 对称:排空在途回复、清理监听器(LangBot 重连泄漏教训) */
  disconnect(opts?: { userInitiated?: boolean }): Promise<void>

  /** 连接层状态(processing/pending 由 getStats 提供) */
  getStatus(): Omit<ChannelStatusInfo, 'channel' | 'processingCount' | 'pendingCount'>

  /** 处理/排队计数(诊断与状态卡展示);缺省 0/0 */
  getStats?(): { processingCount: number; pendingCount: number }

  /** 按消息回复(一次性文本;流式场景优先用 createReplySession) */
  sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }>

  /** 主动推送(cron 通知/告警);前置条件(如企微需用户先发言)由实现自查 */
  push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }>

  /**
   * 流式回复会话(capabilities.streamingKind !== 'none' 时必须实现):
   * 立即发出占位(秒回),随后 update 全量文本,finalize/fail 收尾。
   */
  createReplySession?(msg: InboundMessage, placeholderText: string): Promise<ReplySession>

  /** 接收附件(capabilities.receivesFiles 时必须实现):下载到 filesDir 并返回本地路径 */
  fetchAttachment?(msg: InboundMessage, att: InboundAttachment): Promise<ChannelFetchedAttachment>

  /** Webhook/HTTP 入站(azure_bot / 部分 voice):由主进程 HTTP 网关回调 */
  handleHttpWebhook?(req: {
    path: string
    headers: Record<string, string>
    body: Buffer | string
  }): Promise<{ status: number; body?: string }>

  /** Token/会话刷新(长轮询渠道掉线自愈) */
  refreshCredentials?(ctx: ChannelRuntimeContext): Promise<void>

  /** 渠道级访问策略快照(可选;UI 展示 + Bridge 预检) */
  getAccessPolicy?(): {
    dm: 'open' | 'allowlist'
    group: 'open' | 'allowlist'
    allowFrom: string[]
    requireMention: boolean
  }
}
