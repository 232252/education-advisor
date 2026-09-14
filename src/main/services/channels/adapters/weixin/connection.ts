// =============================================================
// adapters/weixin/connection — 微信 iLink 长轮询引擎
// start: 凭证 → 流水线 → getupdates 循环; stop: 停轮询 + 排空
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { ReplySession } from '@shared/types'
import { app, type BrowserWindow } from 'electron'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { runAgentStreaming } from '../../bridge/agent-runner'
import { createCommandContext } from '../../bridge/command-context'
import { createChannelPipeline } from '../../bridge/pipeline'
import { ChatMessageQueue } from '../../runtime/chat-queue'
import { type CommandRouter, createDefaultRouter } from '../../runtime/command/router'
import { MessageDedupCache } from '../../runtime/dedup-cache'
import { RecentFilesStore } from '../../runtime/recent-files'
import { RECEIVED_FILES_DIR_NAME, WEIXIN_DEFAULT_BASE_URL } from './constants'
import { ILinkClient, type FetchLike } from './ilink-client'
import { extractUpdatesPayload, parseWeixinMessage, type WeixinDeliveryInfo } from './parsing'
import { createWeixinReplySession } from './reply-session'

export type WeixinBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface WeixinBotStatusInfo {
  status: WeixinBotStatus
  error?: string
  connectedAt?: number
  processingCount: number
  pendingCount: number
}

const DELIVERY_CACHE_MAX = 256

class WeixinBotService extends EventEmitter {
  private client: ILinkClient | null = null
  private router: CommandRouter
  private currentStatus: WeixinBotStatus = 'idle'
  private lastError?: string
  private connectedAt?: number
  private processingCount = 0
  private dedup = new MessageDedupCache()
  private pipeline: { queue: ChatMessageQueue; activeSessions: Set<ReplySession> } | null = null
  private readonly recentFiles = new RecentFilesStore()
  private filesDir = ''
  private userStopped = false
  private pollAbort: AbortController | null = null
  private cursor = ''
  private readonly deliveries = new Map<string, WeixinDeliveryInfo>()
  /** 按用户缓存最近 context_token(弱主动推送用) */
  private readonly contextByUser = new Map<string, string>()

  constructor() {
    super()
    this.setMaxListeners(20)
    this.router = createDefaultRouter()
  }

  getStatus(): WeixinBotStatusInfo {
    return {
      status: this.currentStatus,
      error: this.lastError,
      connectedAt: this.connectedAt,
      processingCount: this.processingCount,
      pendingCount: this.pipeline?.queue.pendingCount ?? 0,
    }
  }

  getClient(): ILinkClient | null {
    return this.client
  }

  getContextToken(userId: string): string | undefined {
    return this.contextByUser.get(userId)
  }

  async start(
    botToken: string,
    win: BrowserWindow | null,
    opts: {
      baseUrl?: string
      agentId?: string
      fetchImpl?: FetchLike
    } = {},
  ): Promise<void> {
    botToken = botToken.trim()
    if (!botToken) {
      this.setStatus('error', { error: 'Bot Token 为空,请先扫码连接' })
      return
    }
    if (this.client && this.currentStatus === 'connected') {
      log('info', 'weixin', 'already connected, skip')
      return
    }
    if (this.client) {
      await this.stop({ userInitiated: false })
    }
    this.userStopped = false
    this.dedup = new MessageDedupCache()
    this.deliveries.clear()
    this.cursor = ''
    this.setStatus('connecting')

    const client = new ILinkClient({
      botToken,
      baseUrl: opts.baseUrl || WEIXIN_DEFAULT_BASE_URL,
      fetchImpl: opts.fetchImpl,
    })
    this.client = client

    try {
      this.filesDir = path.join(app.getPath('userData'), RECEIVED_FILES_DIR_NAME)
    } catch {
      this.filesDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', RECEIVED_FILES_DIR_NAME)
    }

    const boundAgentId = opts.agentId || undefined
    const activeSessions = new Set<ReplySession>()
    const pipeline = createChannelPipeline({
      router: this.router,
      commandContext: createCommandContext(win),
      sendText: async (messageId, text) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        await client.sendText(delivery.toUserId, text, delivery.contextToken)
      },
      createSession: async (messageId, _placeholder) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        return createWeixinReplySession(client, delivery)
      },
      downloadAttachment: async () => ({ ok: false, error: '微信 v1 暂不支持附件下载' }),
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
      channelLabel: '微信',
    })
    this.pipeline = { queue: new ChatMessageQueue(pipeline), activeSessions }

    this.pollAbort = new AbortController()
    this.connectedAt = Date.now()
    this.setStatus('connected')
    void this.pollLoop()
    log('info', 'weixin', 'long-poll started')
  }

  private async pollLoop(): Promise<void> {
    const abort = this.pollAbort
    const client = this.client
    if (!abort || !client) return
    while (!abort.signal.aborted && !this.userStopped) {
      try {
        const data = await client.getUpdates(this.cursor)
        if (abort.signal.aborted) break
        const { msgs, cursor } = extractUpdatesPayload(data)
        if (cursor) this.cursor = cursor
        for (const raw of msgs) {
          this.handleIncoming(raw)
        }
      } catch (err) {
        if (abort.signal.aborted || this.userStopped) break
        const msg = errText(err)
        // 超时属长轮询正常路径,继续;鉴权失败则进 error
        if (/abort|timeout|TimeoutError|AbortError/i.test(msg)) {
          continue
        }
        if (/401|403|token|鉴权|unauthorized/i.test(msg)) {
          this.setStatus('error', { error: `微信凭证失效,请重新扫码: ${msg}` })
          break
        }
        log('warn', 'weixin', `getupdates error, retry: ${msg}`)
        await sleep(2000)
      }
    }
  }

  private handleIncoming(raw: unknown): void {
    const parsed = parseWeixinMessage(raw)
    if (!parsed) return
    const { inbound, delivery } = parsed
    if (this.dedup.has(inbound.providerMessageId)) return
    this.dedup.remember(inbound.providerMessageId)
    this.rememberDelivery(inbound.providerMessageId, delivery)
    if (delivery.contextToken) {
      this.contextByUser.set(delivery.toUserId, delivery.contextToken)
    }
    const queue = this.pipeline?.queue
    if (!queue) return
    if (
      !queue.submit({
        parsed: {
          messageId: inbound.providerMessageId,
          chatId: inbound.chat.id,
          chatType: inbound.chat.type,
          text: inbound.text,
          attachments: inbound.attachments,
        },
      })
    ) {
      log('warn', 'weixin', `pending queue full (${queue.pendingCount}), drop message`)
      void clientSendBusy(this.client, delivery)
    }
  }

  private rememberDelivery(messageId: string, delivery: WeixinDeliveryInfo): void {
    this.deliveries.set(messageId, delivery)
    if (this.deliveries.size > DELIVERY_CACHE_MAX) {
      const first = this.deliveries.keys().next().value
      if (first) this.deliveries.delete(first)
    }
  }

  async stop(opts?: { userInitiated?: boolean }): Promise<void> {
    this.userStopped = opts?.userInitiated !== false
    this.pollAbort?.abort()
    this.pollAbort = null
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
    this.client = null
    this.connectedAt = undefined
    this.setStatus('idle')
    log('info', 'weixin', 'stopped')
  }

  /** 弱主动:需已有 context_token */
  async pushText(userId: string, text: string): Promise<void> {
    const client = this.client
    if (!client) throw new Error('微信未连接')
    const token = this.contextByUser.get(userId)
    if (!token) throw new Error('无可用 context_token:用户须先在微信私聊发言')
    await client.sendText(userId, text, token)
  }

  private setStatus(status: WeixinBotStatus, opts?: { error?: string }): void {
    this.currentStatus = status
    if (opts?.error !== undefined) this.lastError = opts.error
    if (status === 'connected') this.lastError = undefined
    if (status === 'idle') this.lastError = undefined
    this.emit('status', this.getStatus())
  }
}

async function clientSendBusy(
  client: ILinkClient | null,
  delivery: WeixinDeliveryInfo,
): Promise<void> {
  if (!client) return
  try {
    await client.sendText(delivery.toUserId, '当前消息队列繁忙,请稍后重试', delivery.contextToken)
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const weixinBotService = new WeixinBotService()
