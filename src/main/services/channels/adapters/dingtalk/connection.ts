// =============================================================
// adapters/dingtalk/connection — 钉钉机器人引擎(连接生命周期/编排)
// 与飞书 connection.ts 同构(单例 EventEmitter):
//   start: 凭证预检 → 组装批队列流水线(秒回占位/合并窗口/命令直通)
//          → Stream 客户端(自研协议,断连自动重连) → 状态广播
//   stop : 排空队列收尾 → 会话 fail → 断开 WS
// 每条消息的投递信息(sessionWebhook/会话定位)按 msgId 存 LRU,
// 回复文本/建卡片时取出。
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { ReplySession } from '@shared/types'
import { app, type BrowserWindow, powerMonitor } from 'electron'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { settingsService } from '../../../settings-service'
import { runAgentStreaming } from '../../bridge/agent-runner'
import { createCommandContext } from '../../bridge/command-context'
import { createChannelPipeline } from '../../bridge/pipeline'
import { ChatMessageQueue } from '../../runtime/chat-queue'
import { type CommandRouter, createDefaultRouter } from '../../runtime/command/router'
import { MessageDedupCache } from '../../runtime/dedup-cache'
import { RecentFilesStore } from '../../runtime/recent-files'
import { DingtalkApiClient, type FetchLike } from './api'
import { RECEIVED_FILES_DIR_NAME } from './constants'
import { parseDingtalkMessage, type DingtalkDeliveryInfo } from './parsing'
import { createDingtalkReplySession } from './reply-session'
import { DingtalkStreamClient, type WsFactory } from './stream-client'

/** 引擎状态(与飞书 BotStatus 对齐) */
export type DingtalkBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface DingtalkBotStatusInfo {
  status: DingtalkBotStatus
  clientId?: string
  error?: string
  connectedAt?: number
  processingCount: number
  pendingCount: number
}

/** msgId → 投递信息 LRU 上限(超长会话防内存增长;回复只发生在消息后数秒~分钟) */
const DELIVERY_CACHE_MAX = 256

class DingtalkBotService extends EventEmitter {
  private client: DingtalkStreamClient | null = null
  private api: DingtalkApiClient | null = null
  private router: CommandRouter
  private currentStatus: DingtalkBotStatus = 'idle'
  private currentClientId?: string
  private lastError?: string
  private connectedAt?: number
  private processingCount = 0
  /** headers.messageId(协议层) + msgId(业务层重发) 双键去重 */
  private dedup = new MessageDedupCache()
  private msgIdDedup = new MessageDedupCache()
  private pipeline: { queue: ChatMessageQueue; activeSessions: Set<ReplySession> } | null = null
  private readonly recentFiles = new RecentFilesStore()
  private filesDir = ''
  private userStopped = false
  private creds: { clientId: string; clientSecret: string; cardTemplateId?: string } | null = null
  /** msgId → 投递信息(sessionWebhook 等) */
  private readonly deliveries = new Map<string, DingtalkDeliveryInfo>()

  constructor() {
    super()
    this.setMaxListeners(20)
    this.router = createDefaultRouter()
  }

  getStatus(): DingtalkBotStatusInfo {
    return {
      status: this.currentStatus,
      clientId: this.currentClientId,
      error: this.lastError,
      connectedAt: this.connectedAt,
      processingCount: this.processingCount,
      pendingCount: this.pipeline?.queue.pendingCount ?? 0,
    }
  }

  /** 接收文件目录 */
  getFilesDir(): string {
    return this.filesDir
  }

  /** API 客户端(适配器经此下载附件/推送;stop 后为 null) */
  getApi(): DingtalkApiClient | null {
    return this.api
  }

  async start(
    clientId: string,
    clientSecret: string,
    win: BrowserWindow | null,
    opts: {
      cardTemplateId?: string
      allowGroups?: boolean
      agentId?: string
      /** 测试注入(vitest 假 fetch/假 WS;运行时缺省真实现) */
      fetchImpl?: FetchLike
      wsFactory?: WsFactory
    } = {},
  ): Promise<void> {
    clientId = clientId.trim()
    clientSecret = clientSecret.trim()
    if (this.client && this.currentClientId === clientId && this.currentStatus === 'connected') {
      log('info', 'dingtalk', `already connected with clientId=${clientId}, skip`)
      return
    }
    if (this.client) {
      await this.stop({ userInitiated: false })
    }
    this.userStopped = false

    if (!clientId || !clientSecret) {
      this.setStatus('error', { error: 'Client ID 或 Client Secret 为空' })
      return
    }

    // 连接间状态干净: 去重缓存随连接重建(换凭证/重启后旧窗口无意义)
    this.dedup = new MessageDedupCache()
    this.msgIdDedup = new MessageDedupCache()
    this.deliveries.clear()

    this.currentClientId = clientId
    this.setStatus('connecting')
    this.creds = { clientId, clientSecret, cardTemplateId: opts.cardTemplateId?.trim() || undefined }

    // 凭证预检(不建长连接): 错凭证立即报错而非无限"连接中"
    const api = new DingtalkApiClient({ clientId, clientSecret, fetchImpl: opts.fetchImpl })
    const credError = await api.validateCredentials()
    if (credError) {
      this.setStatus('error', { error: credError })
      log('error', 'dingtalk', `credential validation failed: ${credError}`)
      return
    }
    this.api = api

    try {
      this.filesDir = path.join(app.getPath('userData'), RECEIVED_FILES_DIR_NAME)
    } catch {
      this.filesDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', RECEIVED_FILES_DIR_NAME)
    }

    const allowGroups = opts.allowGroups !== false
    const boundAgentId = opts.agentId || undefined

    // 批处理流水线(与飞书同款: 秒回占位 → 流式卡片 → 终稿;纯文件批回确认)
    const activeSessions = new Set<ReplySession>()
    const pipeline = createChannelPipeline({
      router: this.router,
      commandContext: createCommandContext(win),
      sendText: async (messageId, text) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        await api.replyText(
          delivery.sessionWebhook,
          text,
          delivery.conversationType === '2' ? [delivery.senderStaffId] : [],
        )
      },
      createSession: async (messageId, placeholderText) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        return createDingtalkReplySession(
          { api, delivery, cardTemplateId: this.creds?.cardTemplateId },
          placeholderText,
        )
      },
      downloadAttachment: async (messageId, att) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) return { ok: false, error: `消息 ${messageId} 的投递信息已失效` }
        return api.downloadAttachment({
          downloadCode: att.fileKey,
          fileName: att.fileName,
          kind: att.kind,
          dir: this.filesDir,
        })
      },
      filesDir: this.filesDir,
      onProcessingStart: () => {
        this.processingCount++
      },
      onProcessingEnd: () => {
        this.processingCount--
      },
      activeSessions,
      recentFiles: this.recentFiles,
      runStream: (prompt, onChunk) => runAgentStreaming(prompt, win, onChunk, boundAgentId),
      channelLabel: '钉钉',
    })
    this.pipeline = { queue: new ChatMessageQueue(pipeline), activeSessions }

    // Stream 客户端(自研协议;状态事件转发到引擎状态机)
    this.client = new DingtalkStreamClient({
      clientId,
      clientSecret,
      fetchImpl: opts.fetchImpl,
      wsFactory: opts.wsFactory,
      onMessage: (data, protocolMessageId) =>
        this.handleIncoming(data, protocolMessageId, allowGroups),
    })
    this.client.on('status', (status: string, detail?: string) => {
      if (status === 'connected') {
        this.connectedAt = Date.now()
        this.setStatus('connected')
        return
      }
      if (status === 'connecting') {
        if (this.currentStatus !== 'connected' || !this.client) return
        // 已连接后的重连中(瞬断) — 显示连接中但不丢 lastError 语义
        this.setStatus('connecting')
        return
      }
      if (status === 'error') {
        this.setStatus('error', { error: detail ?? '钉钉 Stream 连接失败' })
      }
    })

    this.attachResumeListener()

    try {
      await this.client.connect()
    } catch (err) {
      const msg = errText(err)
      this.setStatus('error', { error: msg })
      log('error', 'dingtalk', `start failed: ${msg}`)
      this.client = null
      this.api = null
    }
  }

  /** 回调 data(字符串) → 去重 → 解析 → 入队(同步返回让 ack 立即发出) */
  private handleIncoming(data: string, protocolMessageId: string, allowGroups: boolean): void {
    // 协议层去重: 事件重推时 headers.messageId 不变(机器人消息 fire-and-forget,
    // 官方不重推,但网络抖动下低概率重复;幂等成本极低)
    if (protocolMessageId && this.dedup.has(protocolMessageId)) {
      log('info', 'dingtalk', `duplicate frame ${protocolMessageId}, skip`)
      return
    }
    if (protocolMessageId) this.dedup.remember(protocolMessageId)

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(data)
    } catch (err) {
      log('warn', 'dingtalk', `callback data parse failed: ${errText(err)}`)
      return
    }
    // 业务层去重: 钉钉重发时 headers.messageId 换新值但 data.msgId 不变
    const msgId =
      parsedJson && typeof parsedJson === 'object'
        ? String((parsedJson as { msgId?: unknown }).msgId ?? '')
        : ''
    if (msgId && this.msgIdDedup.has(msgId)) {
      log('info', 'dingtalk', `duplicate message ${msgId}, skip`)
      return
    }

    const result = parseDingtalkMessage(parsedJson, { allowGroups })
    if (!result) return
    if (msgId) this.msgIdDedup.remember(msgId)
    this.rememberDelivery(result.parsed.messageId, result.delivery)

    const queue = this.pipeline?.queue
    if (!queue) return
    if (!queue.submit({ parsed: result.parsed })) {
      log('warn', 'dingtalk', `pending queue full (${queue.pendingCount}), drop message`)
      void this.api
        ?.replyText(
          result.delivery.sessionWebhook,
          '当前消息处理繁忙,请稍后再发。',
          result.delivery.conversationType === '2' ? [result.delivery.senderStaffId] : [],
        )
        .catch(() => {})
    }
  }

  /** 投递信息 LRU(新条目插入尾部,超限逐出头部) */
  private rememberDelivery(msgId: string, delivery: DingtalkDeliveryInfo): void {
    if (this.deliveries.size >= DELIVERY_CACHE_MAX) {
      const oldest = this.deliveries.keys().next().value
      if (oldest !== undefined) this.deliveries.delete(oldest)
    }
    this.deliveries.set(msgId, delivery)
  }

  /** 系统唤醒 → 强制重连(休眠期间 socket 静默死亡不触发 close) */
  private readonly handleSystemResume = (): void => {
    if (!this.client || this.userStopped) return
    log('info', 'dingtalk', 'system resumed from sleep, forcing stream reconnect')
    this.setStatus('connecting')
    this.client.forceReconnect('system-resume')
  }

  private attachResumeListener(): void {
    try {
      powerMonitor?.on('resume', this.handleSystemResume)
    } catch {
      /* 非 Electron 环境忽略 */
    }
  }

  private detachResumeListener(): void {
    try {
      powerMonitor?.removeListener('resume', this.handleSystemResume)
    } catch {
      /* ignore */
    }
  }

  async stop(opts?: { userInitiated?: boolean }): Promise<void> {
    if (opts?.userInitiated !== false) {
      this.userStopped = true
    }
    this.detachResumeListener()
    // 排空队列: 排队消息回"未处理",运行中的占位卡片写入中断说明
    if (this.pipeline) {
      const { queue, activeSessions } = this.pipeline
      this.pipeline = null
      try {
        await queue.cancelAll()
      } catch (err) {
        log('warn', 'dingtalk', `queue cancel error: ${errText(err)}`)
      }
      for (const session of activeSessions) {
        try {
          await session.fail('机器人已停止,本次回复已中断,请重新发送消息。')
        } catch {
          /* 收尾失败不影响停止流程 */
        }
      }
      activeSessions.clear()
    }
    this.client?.stop()
    this.client = null
    this.api = null
    this.creds = null
    this.connectedAt = undefined
    if (this.currentStatus !== 'idle') {
      this.setStatus('idle')
    }
    log('info', 'dingtalk', 'stopped')
  }

  isUserStopped(): boolean {
    return this.userStopped
  }

  private setStatus(
    status: DingtalkBotStatus,
    extra?: { error?: string; connectedAt?: number },
  ): void {
    this.currentStatus = status
    if (extra?.error !== undefined) this.lastError = extra.error
    if (status === 'connected') this.lastError = undefined
    if (extra?.connectedAt !== undefined) this.connectedAt = extra.connectedAt
    if (status === 'idle' || status === 'error') this.connectedAt = undefined
    this.emit('status', this.getStatus())
  }
}

export const dingtalkBotService = new DingtalkBotService()
