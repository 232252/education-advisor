// =============================================================
// adapters/qq/connection — QQ 机器人引擎(WS + 流水线 + 诊断)
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { InboundAttachment, OutboundMediaRef, ReplySession } from '@shared/types'
import { app, type BrowserWindow } from 'electron'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { runAgentStreaming } from '../../bridge/agent-runner'
import { createCommandContext } from '../../bridge/command-context'
import { createChannelPipeline } from '../../bridge/pipeline'
import { writeAttachmentBytes } from '../../runtime/attachment-store'
import { ChatMessageQueue } from '../../runtime/chat-queue'
import { type CommandRouter, createDefaultRouter } from '../../runtime/command/router'
import { MessageDedupCache } from '../../runtime/dedup-cache'
import { RecentFilesStore } from '../../runtime/recent-files'
import { QqApiClient } from './api'
import { RECEIVED_FILES_DIR_NAME } from './constants'
import { QqGatewayClient, type WsFactory } from './gateway'
import { parseQqDispatchEvent, type QqDeliveryInfo } from './parsing'
import { createQqReplySession } from './reply-session'
import type { FetchLike } from './token'

export type QqBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface QqBotStatusInfo {
  status: QqBotStatus
  error?: string
  connectedAt?: number
  processingCount: number
  pendingCount: number
  lastMessageAt?: number
  lastErrorAt?: number
  reconnectAttempt?: number
}

const DELIVERY_CACHE_MAX = 256

class QqBotService extends EventEmitter {
  private gateway: QqGatewayClient | null = null
  private api: QqApiClient | null = null
  private router: CommandRouter
  private currentStatus: QqBotStatus = 'idle'
  private lastError?: string
  private connectedAt?: number
  private lastMessageAt?: number
  private lastErrorAt?: number
  private reconnectAttempt = 0
  private processingCount = 0
  private dedup = new MessageDedupCache()
  private pipeline: { queue: ChatMessageQueue; activeSessions: Set<ReplySession> } | null = null
  private readonly recentFiles = new RecentFilesStore()
  private filesDir = ''
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: stop() 置位、轮询/重连回调读取,规则误报
  private userStopped = false
  private readonly deliveries = new Map<string, QqDeliveryInfo>()
  private fetchImpl: FetchLike = fetch

  constructor() {
    super()
    this.setMaxListeners(20)
    this.router = createDefaultRouter()
  }

  getStatus(): QqBotStatusInfo {
    return {
      status: this.currentStatus,
      error: this.lastError,
      connectedAt: this.connectedAt,
      processingCount: this.processingCount,
      pendingCount: this.pipeline?.queue.pendingCount ?? 0,
      lastMessageAt: this.lastMessageAt,
      lastErrorAt: this.lastErrorAt,
      reconnectAttempt: this.reconnectAttempt,
    }
  }

  getApi(): QqApiClient | null {
    return this.api
  }

  async start(
    appId: string,
    clientSecret: string,
    win: BrowserWindow | null,
    opts: {
      allowGroups?: boolean
      agentId?: string
      fetchImpl?: FetchLike
      wsFactory?: WsFactory
    } = {},
  ): Promise<void> {
    appId = appId.trim()
    clientSecret = clientSecret.trim()
    if (!appId || !clientSecret) {
      this.setStatus('error', { error: 'AppID 或 AppSecret 为空' })
      return
    }
    if (this.gateway && this.currentStatus === 'connected') {
      log('info', 'qq', 'already connected, skip')
      return
    }
    if (this.gateway) await this.stop({ userInitiated: false })
    this.userStopped = false
    this.dedup = new MessageDedupCache()
    this.deliveries.clear()
    this.reconnectAttempt = 0
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.setStatus('connecting')

    const api = new QqApiClient(appId, clientSecret, undefined, opts.fetchImpl)
    const credError = await api.validateCredentials()
    if (credError) {
      this.setStatus('error', { error: credError })
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
    const activeSessions = new Set<ReplySession>()
    const pipeline = createChannelPipeline({
      router: this.router,
      commandContext: createCommandContext(win),
      sendText: async (messageId, text) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        await api.replyOutbound(delivery, text)
      },
      createSession: async (messageId) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        return createQqReplySession(api, delivery)
      },
      downloadAttachment: async (_messageId, att) => this.downloadAttachment(att),
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
      channelLabel: 'QQ',
    })
    this.pipeline = { queue: new ChatMessageQueue(pipeline), activeSessions }

    this.gateway = new QqGatewayClient({
      appId,
      clientSecret,
      fetchImpl: opts.fetchImpl,
      wsFactory: opts.wsFactory,
      onDispatch: (eventType, data) => this.handleDispatch(eventType, data, allowGroups),
    })
    this.gateway.on('status', (status: string, detail?: string) => {
      if (status === 'connected') {
        this.connectedAt = Date.now()
        this.reconnectAttempt = 0
        this.setStatus('connected')
        return
      }
      if (status === 'connecting') {
        this.setStatus('connecting')
        return
      }
      if (status === 'error') {
        this.setStatus('error', { error: detail ?? 'QQ Gateway 连接失败' })
      }
    })
    this.gateway.on('reconnect', (attempt: number, delay: number) => {
      this.reconnectAttempt = attempt
      log('info', 'qq', `gateway reconnect attempt=${attempt} delay=${delay}ms`)
      this.emit('status', this.getStatus())
    })

    try {
      await this.gateway.connect()
    } catch (err) {
      const msg = errText(err)
      this.setStatus('error', { error: msg })
      this.gateway = null
      this.api = null
    }
  }

  /** 统一引擎出站:按 providerMessageId 查投递缓存后 replyOutbound */
  async replyOutboundFromMessage(
    providerMessageId: string,
    text: string,
    media: OutboundMediaRef[] = [],
  ): Promise<void> {
    const api = this.api
    if (!api) throw new Error('QQ 未连接')
    const delivery = this.deliveries.get(providerMessageId)
    if (!delivery) throw new Error(`消息 ${providerMessageId} 的投递信息已失效`)
    await api.replyOutbound(delivery, text, media)
  }

  /** 统一引擎流式会话:按 providerMessageId 建 ReplySession */
  createReplySessionFromMessage(
    providerMessageId: string,
    media: OutboundMediaRef[] = [],
  ): ReplySession {
    const api = this.api
    if (!api) throw new Error('QQ 未连接')
    const delivery = this.deliveries.get(providerMessageId)
    if (!delivery) throw new Error(`消息 ${providerMessageId} 的投递信息已失效`)
    return createQqReplySession(api, delivery, media)
  }

  getDelivery(providerMessageId: string): QqDeliveryInfo | undefined {
    return this.deliveries.get(providerMessageId)
  }

  private async downloadAttachment(
    att: InboundAttachment,
  ): Promise<
    | { ok: true; saved: { name: string; path: string; bytes: number } }
    | { ok: false; error: string }
  > {
    const url = att.fileKey
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '无效的 QQ 附件 URL' }
    try {
      const res = await this.fetchImpl(url)
      if (!res.ok) return { ok: false, error: `下载失败 HTTP ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      const name = path.basename(att.fileName || url.split('?')[0] || 'qq-file.bin')
      return writeAttachmentBytes({
        bytes: buf,
        fileName: name,
        kind: att.kind === 'image' ? 'image' : 'file',
        dir: this.filesDir,
        logScope: 'qq',
      })
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  }

  private handleDispatch(eventType: string, data: unknown, allowGroups: boolean): void {
    const result = parseQqDispatchEvent(eventType, data, { allowGroups })
    if (!result) return
    if (this.dedup.has(result.parsed.messageId)) return
    this.dedup.remember(result.parsed.messageId)
    this.rememberDelivery(result.parsed.messageId, result.delivery)
    this.lastMessageAt = Date.now()
    this.emit('status', this.getStatus())
    const queue = this.pipeline?.queue
    if (!queue) return
    if (!queue.submit({ parsed: result.parsed })) {
      log('warn', 'qq', `pending queue full (${queue.pendingCount}), drop`)
      void this.api?.replyText(result.delivery, '当前消息队列繁忙,请稍后重试').catch(() => {})
    }
  }

  private rememberDelivery(msgId: string, delivery: QqDeliveryInfo): void {
    if (this.deliveries.size >= DELIVERY_CACHE_MAX) {
      const oldest = this.deliveries.keys().next().value
      if (oldest !== undefined) this.deliveries.delete(oldest)
    }
    this.deliveries.set(msgId, delivery)
  }

  async stop(opts?: { userInitiated?: boolean }): Promise<void> {
    this.userStopped = opts?.userInitiated !== false
    this.gateway?.stop()
    this.gateway = null
    if (this.pipeline) {
      const { queue, activeSessions } = this.pipeline
      this.pipeline = null
      try {
        await queue.cancelAll()
      } catch {
        /* ignore */
      }
      for (const s of activeSessions) {
        try {
          await s.fail('频道已断开')
        } catch {
          /* ignore */
        }
      }
      activeSessions.clear()
    }
    this.api = null
    this.connectedAt = undefined
    this.setStatus('idle')
    log('info', 'qq', 'stopped')
  }

  private setStatus(status: QqBotStatus, opts?: { error?: string }): void {
    this.currentStatus = status
    if (opts?.error !== undefined) {
      this.lastError = opts.error
      this.lastErrorAt = Date.now()
    }
    if (status === 'connected' || status === 'idle') this.lastError = undefined
    this.emit('status', this.getStatus())
  }
}

export const qqBotService = new QqBotService()
