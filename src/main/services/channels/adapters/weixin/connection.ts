// =============================================================
// adapters/weixin/connection — 微信 iLink 长轮询引擎(全功能)
// start: 凭证 → 恢复 cursor/context → 流水线 → getupdates 循环
// 退避 + 游标持久化 + 媒体下载 + 诊断字段
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { InboundAttachment, ReplySession } from '@shared/types'
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
import { writeAttachmentBytes } from '../../runtime/attachment-store'
import { checkAcl, policyFromConfig, type AclPolicy } from '../_shared/acl'
import { InboundDebouncer, mergeTextMessages } from '../_shared/debounce'
import {
  RECEIVED_FILES_DIR_NAME,
  STATE_DIR_NAME,
  WEIXIN_DEFAULT_BASE_URL,
  WEIXIN_POLL_BACKOFF_MS,
} from './constants'
import { ILinkClient, type FetchLike } from './ilink-client'
import { downloadILinkMedia } from './media'
import { sendWeixinOutbound } from './outbound'
import {
  decodeWeixinMediaKey,
  extractUpdatesPayload,
  parseWeixinMessage,
  type WeixinDeliveryInfo,
} from './parsing'
import { loadWeixinPersist, saveWeixinContextTokens, saveWeixinCursor } from './persist'
import { createWeixinReplySession } from './reply-session'
import { WeixinTypingManager } from './typing'

export type WeixinBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface WeixinBotStatusInfo {
  status: WeixinBotStatus
  error?: string
  connectedAt?: number
  processingCount: number
  pendingCount: number
  lastMessageAt?: number
  lastErrorAt?: number
  reconnectAttempt?: number
}

const DELIVERY_CACHE_MAX = 256

class WeixinBotService extends EventEmitter {
  private client: ILinkClient | null = null
  private router: CommandRouter
  private currentStatus: WeixinBotStatus = 'idle'
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
  private stateDir = ''
  private userStopped = false
  private pollAbort: AbortController | null = null
  private cursor = ''
  private readonly deliveries = new Map<string, WeixinDeliveryInfo>()
  /** 按用户缓存最近 context_token(弱主动推送用) */
  private readonly contextByUser = new Map<string, string>()
  private acl: AclPolicy = { dm: 'open', group: 'open', allowFrom: [] }
  private debouncer: InboundDebouncer<{
    messageId: string
    chatId: string
    chatType: 'p2p' | 'group'
    text: string
    attachments: import('@shared/types').InboundAttachment[]
    delivery: WeixinDeliveryInfo
  }> | null = null
  private readonly typing = new WeixinTypingManager()

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
      lastMessageAt: this.lastMessageAt,
      lastErrorAt: this.lastErrorAt,
      reconnectAttempt: this.reconnectAttempt,
    }
  }

  getClient(): ILinkClient | null {
    return this.client
  }

  getContextToken(userId: string): string | undefined {
    return this.contextByUser.get(userId)
  }

  private resolveDirs(): void {
    try {
      const root = app.getPath('userData')
      this.filesDir = path.join(root, RECEIVED_FILES_DIR_NAME)
      this.stateDir = path.join(root, STATE_DIR_NAME)
    } catch {
      const tmp = process.env.TEMP ?? process.env.TMP ?? '.'
      this.filesDir = path.join(tmp, RECEIVED_FILES_DIR_NAME)
      this.stateDir = path.join(tmp, STATE_DIR_NAME)
    }
  }

  async start(
    botToken: string,
    win: BrowserWindow | null,
    opts: {
      baseUrl?: string
      agentId?: string
      fetchImpl?: FetchLike
      /** channel settings for ACL / debounce */
      config?: Record<string, unknown>
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
    this.reconnectAttempt = 0
    this.setStatus('connecting')
    this.resolveDirs()

    const persisted = loadWeixinPersist(this.stateDir)
    this.cursor = persisted.cursor
    this.contextByUser.clear()
    for (const [k, v] of Object.entries(persisted.contextByUser)) {
      this.contextByUser.set(k, v)
    }

    this.acl = policyFromConfig(opts.config ?? {})
    const debounceMs = Math.max(0, Number(opts.config?.debounceMs ?? 0) || 0)
    this.debouncer?.clear()
    this.typing.clear()
    this.debouncer = new InboundDebouncer({
      keyOf: (item) => item.chatId || item.delivery.toUserId,
      windowMs: debounceMs,
      onAppend: (existing, incoming) => {
        // 有附件则立刻 flush 前批,再单独处理本条(对齐 QwenPaw no-text / media bypass)
        if ((incoming.attachments?.length ?? 0) > 0 || (existing.some((e) => (e.attachments?.length ?? 0) > 0))) {
          return [...existing, incoming]
        }
        return mergeTextMessages(existing, incoming)
      },
      flush: (_key, items) => {
        for (const item of items) this.enqueueParsed(item)
      },
    })

    const client = new ILinkClient({
      botToken,
      baseUrl: opts.baseUrl || WEIXIN_DEFAULT_BASE_URL,
      fetchImpl: opts.fetchImpl,
    })
    this.client = client

    const boundAgentId = opts.agentId || undefined
    const activeSessions = new Set<ReplySession>()
    const pipeline = createChannelPipeline({
      router: this.router,
      commandContext: createCommandContext(win),
      sendText: async (messageId, text) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        await sendWeixinOutbound(client, delivery, text)
      },
      createSession: async (messageId, _placeholder) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        return createWeixinReplySession(client, delivery, [], (sendCancel) => {
          this.typing.stopForUser(delivery.toUserId, sendCancel !== false)
        })
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
      channelLabel: '微信',
    })
    this.pipeline = { queue: new ChatMessageQueue(pipeline), activeSessions }

    this.pollAbort = new AbortController()
    this.connectedAt = Date.now()
    this.setStatus('connected')
    void this.pollLoop()
    log('info', 'weixin', `long-poll started (cursor=${this.cursor ? 'resumed' : 'fresh'})`)
  }

  private async downloadAttachment(
    att: InboundAttachment,
  ): Promise<{ ok: true; saved: { name: string; path: string; bytes: number } } | { ok: false; error: string }> {
    const client = this.client
    if (!client) return { ok: false, error: '微信未连接' }
    const meta = decodeWeixinMediaKey(att.fileKey)
    if (!meta) return { ok: false, error: '无效的微信媒体引用' }
    const safeName = path.basename(meta.fileName || att.fileName || 'media.bin')
    const dest = path.join(this.filesDir, `_tmp_${Date.now()}_${safeName}`)
    try {
      await downloadILinkMedia(client, {
        encryptQueryParam: meta.encryptQueryParam,
        aesKey: meta.aesKey,
        destPath: dest,
      })
      const bytes = await import('node:fs').then((fs) => fs.readFileSync(dest))
      try {
        await import('node:fs').then((fs) => fs.unlinkSync(dest))
      } catch {
        /* ignore tmp cleanup */
      }
      return writeAttachmentBytes({
        bytes,
        fileName: safeName,
        kind: att.kind === 'image' ? 'image' : 'file',
        dir: this.filesDir,
        logScope: 'weixin',
      })
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  }

  private async pollLoop(): Promise<void> {
    const abort = this.pollAbort
    const client = this.client
    if (!abort || !client) return
    while (!abort.signal.aborted && !this.userStopped) {
      try {
        const data = await client.getUpdates(this.cursor)
        if (abort.signal.aborted) break
        const { msgs, cursor, ret } = extractUpdatesPayload(data)
        if (cursor) {
          this.cursor = cursor
          saveWeixinCursor(this.stateDir, this.cursor)
        }
        this.reconnectAttempt = 0
        for (const raw of msgs) {
          this.handleIncoming(raw)
        }
        // ret=-1: 长轮询空闲超时,属正常
        if (ret !== 0 && ret !== -1 && msgs.length === 0) {
          log('warn', 'weixin', `getupdates ret=${ret}, brief pause`)
          await sleep(3_000)
        }
      } catch (err) {
        if (abort.signal.aborted || this.userStopped) break
        const msg = errText(err)
        if (/abort|timeout|TimeoutError|AbortError/i.test(msg)) {
          continue
        }
        if (/401|403|token|鉴权|unauthorized/i.test(msg)) {
          this.lastErrorAt = Date.now()
          this.setStatus('error', { error: `微信凭证失效,请重新扫码: ${msg}` })
          break
        }
        this.reconnectAttempt++
        this.lastErrorAt = Date.now()
        this.lastError = msg
        const delay =
          WEIXIN_POLL_BACKOFF_MS[
            Math.min(this.reconnectAttempt - 1, WEIXIN_POLL_BACKOFF_MS.length - 1)
          ] ?? 30_000
        log('warn', 'weixin', `getupdates error, backoff ${delay}ms (attempt ${this.reconnectAttempt}): ${msg}`)
        this.emit('status', this.getStatus())
        await sleep(delay)
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
      saveWeixinContextTokens(this.stateDir, this.contextByUser)
    }

    const acl = checkAcl(this.acl, {
      chatType: inbound.chat.type === 'group' ? 'group' : 'p2p',
      senderId: inbound.sender.id,
      chatId: inbound.chat.id,
    })
    if (acl.decision !== 'allow') {
      log('info', 'weixin', `ACL ${acl.decision}: ${acl.reason} sender=${inbound.sender.id}`)
      return
    }

    this.lastMessageAt = Date.now()
    this.emit('status', this.getStatus())

    // typing indicator (QwenPaw: start on receive, refresh until reply done)
    if (this.client && delivery.contextToken) {
      void this.typing.start(this.client, delivery.toUserId, delivery.contextToken)
    }

    const item = {
      messageId: inbound.providerMessageId,
      chatId: inbound.chat.id,
      chatType: (inbound.chat.type === 'group' ? 'group' : 'p2p') as 'p2p' | 'group',
      text: inbound.text,
      attachments: inbound.attachments,
      delivery,
    }
    if (this.debouncer) {
      this.debouncer.push(item)
    } else {
      this.enqueueParsed(item)
    }
  }

  private enqueueParsed(item: {
    messageId: string
    chatId: string
    chatType: 'p2p' | 'group'
    text: string
    attachments: import('@shared/types').InboundAttachment[]
    delivery: WeixinDeliveryInfo
  }): void {
    const queue = this.pipeline?.queue
    if (!queue) return
    this.rememberDelivery(item.messageId, item.delivery)
    if (
      !queue.submit({
        parsed: {
          messageId: item.messageId,
          chatId: item.chatId,
          chatType: item.chatType,
          text: item.text,
          attachments: item.attachments,
        },
      })
    ) {
      log('warn', 'weixin', `pending queue full (${queue.pendingCount}), drop message`)
      this.typing.stopForUser(item.delivery.toUserId, true)
      void clientSendBusy(this.client, item.delivery)
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
    this.debouncer?.flushAll()
    this.debouncer?.clear()
    this.debouncer = null
    this.typing.clear()
    if (this.stateDir && this.contextByUser.size > 0) {
      saveWeixinContextTokens(this.stateDir, this.contextByUser)
    }
    if (this.stateDir && this.cursor) {
      saveWeixinCursor(this.stateDir, this.cursor)
    }
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
    await sendWeixinOutbound(
      client,
      { toUserId: userId, contextToken: token },
      text,
    )
  }

  /** 统一引擎出站(文本 + 媒体标记/显式 media) */
  async replyOutboundFromDelivery(
    delivery: WeixinDeliveryInfo,
    text: string,
    media: import('@shared/types').OutboundMediaRef[] = [],
  ): Promise<void> {
    const client = this.client
    if (!client) throw new Error('微信未连接')
    try {
      await sendWeixinOutbound(client, delivery, text, media)
    } finally {
      this.typing.stopForUser(delivery.toUserId, true)
    }
  }

  private setStatus(status: WeixinBotStatus, opts?: { error?: string }): void {
    this.currentStatus = status
    if (opts?.error !== undefined) {
      this.lastError = opts.error
      this.lastErrorAt = Date.now()
    }
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

