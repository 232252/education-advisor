// =============================================================
// adapters/wecom/connection — 企微智能机器人引擎(连接生命周期/编排)
// 与钉钉引擎同构: 去重(msgid) → 合并队列 → respond-stream 会话 → Agent。
// 附件: url+aeskey 5 分钟内有效 → 收到即下载并 AES 解密落盘
// (不走懒下载;downloadAttachment 由引擎内完成,直接返回落盘结果)。
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { ReplySession } from '@shared/types'
import { app, type BrowserWindow, powerMonitor } from 'electron'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { runAgentStreaming } from '../../bridge/agent-runner'
import { createCommandContext } from '../../bridge/command-context'
import { createChannelPipeline } from '../../bridge/pipeline'
import { ChatMessageQueue } from '../../runtime/chat-queue'
import { type CommandRouter, createDefaultRouter } from '../../runtime/command/router'
import { MessageDedupCache } from '../../runtime/dedup-cache'
import { RecentFilesStore } from '../../runtime/recent-files'
import { RECEIVED_FILES_DIR_NAME, WECOM_CMD } from './constants'
import {
  parseWecomMessage,
  type WecomDeliveryInfo,
  type WecomAttachmentContext,
} from './parsing'
import { createWecomReplySession } from './reply-session'
import { decryptWecomFile } from './crypto'
import { WecomWsClient, type WecomFrame } from './ws-client'

export type WecomBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface WecomBotStatusInfo {
  status: WecomBotStatus
  botId?: string
  error?: string
  connectedAt?: number
  processingCount: number
  pendingCount: number
}

/** msgId → 投递信息 LRU(回复需透传 req_id;附件上下文随投递信息走) */
const DELIVERY_CACHE_MAX = 256

/** 附件下载结果(引擎内完成下载+解密) */
type AttachmentResult = { ok: true; saved: { name: string; path: string; bytes: number } } | { ok: false; error: string }

class WecomBotService extends EventEmitter {
  private client: WecomWsClient | null = null
  private router: CommandRouter
  private currentStatus: WecomBotStatus = 'idle'
  private currentBotId?: string
  private lastError?: string
  private connectedAt?: number
  private processingCount = 0
  private dedup = new MessageDedupCache()
  private pipeline: { queue: ChatMessageQueue; activeSessions: Set<ReplySession> } | null = null
  private readonly recentFiles = new RecentFilesStore()
  private filesDir = ''
  private userStopped = false
  private readonly deliveries = new Map<string, WecomDeliveryInfo>()

  constructor() {
    super()
    this.setMaxListeners(20)
    this.router = createDefaultRouter()
  }

  getStatus(): WecomBotStatusInfo {
    return {
      status: this.currentStatus,
      botId: this.currentBotId,
      error: this.lastError,
      connectedAt: this.connectedAt,
      processingCount: this.processingCount,
      pendingCount: this.pipeline?.queue.pendingCount ?? 0,
    }
  }

  getFilesDir(): string {
    return this.filesDir
  }

  async start(
    botId: string,
    secret: string,
    win: BrowserWindow | null,
    opts: { allowGroups?: boolean; agentId?: string; wsFactory?: WecomWsClient['opts']['wsFactory'] } = {},
  ): Promise<void> {
    botId = botId.trim()
    secret = secret.trim()
    if (this.client && this.currentBotId === botId && this.currentStatus === 'connected') {
      log('info', 'wecom', `already connected with botId=${botId}, skip`)
      return
    }
    if (this.client) {
      await this.stop({ userInitiated: false })
    }
    this.userStopped = false
    if (!botId || !secret) {
      this.setStatus('error', { error: 'Bot ID 或 Secret 为空' })
      return
    }

    this.currentBotId = botId
    this.setStatus('connecting')
    // 连接间状态干净
    this.dedup = new MessageDedupCache()
    this.deliveries.clear()

    try {
      this.filesDir = path.join(app.getPath('userData'), RECEIVED_FILES_DIR_NAME)
    } catch {
      this.filesDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', RECEIVED_FILES_DIR_NAME)
    }

    const allowGroups = opts.allowGroups !== false
    const boundAgentId = opts.agentId || undefined

    // 批处理流水线(与钉钉同构)
    const activeSessions = new Set<ReplySession>()
    const pipeline = createChannelPipeline({
      router: this.router,
      commandContext: createCommandContext(win),
      sendText: async (messageId, text) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        // 命令回执/繁忙提示: 以非流式 respond 单发文本
        this.client?.sendCommand('aibot_respond_msg', delivery.reqId, {
          msgtype: 'text',
          text: { content: text },
        })
      },
      createSession: (messageId, placeholderText) => {
        const delivery = this.deliveries.get(messageId)
        if (!delivery) throw new Error(`消息 ${messageId} 的投递信息已失效`)
        return Promise.resolve(
          createWecomReplySession(
            {
              sendCommand: (cmd, reqId, body) => this.client?.sendCommand(cmd, reqId, body),
              reqId: delivery.reqId,
            },
            placeholderText,
          ),
        )
      },
      downloadAttachment: async (messageId, att) => {
        // 预取缓存直取(收帧时已下载解密,url 5 分钟时效不允许批内再等)
        const prefetched = this.pendingAttachments.get(`${messageId}:${att.fileKey}`)
        if (prefetched) {
          this.pendingAttachments.delete(`${messageId}:${att.fileKey}`)
          return { ok: true, saved: prefetched }
        }
        const delivery = this.deliveries.get(messageId)
        const ctx = delivery?.attachments.find((a) => a.url === att.fileKey)
        if (!ctx) return { ok: false, error: `消息 ${messageId} 的附件上下文已失效` }
        return await this.downloadAttachment(ctx)
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
      channelLabel: '企业微信',
    })
    this.pipeline = { queue: new ChatMessageQueue(pipeline), activeSessions }

    this.client = new WecomWsClient({
      botId,
      secret,
      wsFactory: opts.wsFactory,
      onMessage: (frame) => this.handleIncoming(frame, allowGroups),
    })
    this.client.on('status', (status: string, detail?: string) => {
      if (status === 'connected') {
        this.connectedAt = Date.now()
        this.setStatus('connected')
        return
      }
      if (status === 'connecting') {
        if (this.currentStatus !== 'connected') return
        this.setStatus('connecting')
        return
      }
      if (status === 'error') {
        this.setStatus('error', { error: detail ?? '企微长连接失败' })
      }
    })
    this.attachResumeListener()

    try {
      await this.client.connect()
    } catch (err) {
      const msg = errText(err)
      this.setStatus('error', { error: msg })
      log('error', 'wecom', `start failed: ${msg}`)
      this.client = null
    }
  }

  /** 下载并解密附件(url 5 分钟有效,收到即取) */
  private async downloadAttachment(ctx: WecomAttachmentContext): Promise<AttachmentResult> {
    try {
      const resp = await fetch(ctx.url, { method: 'GET' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const encrypted = Buffer.from(await resp.arrayBuffer())
      const bytes = ctx.aesKey ? decryptWecomFile(encrypted, ctx.aesKey) : encrypted
      const { writeAttachmentBytes } = await import('../../runtime/attachment-store')
      return await writeAttachmentBytes({
        bytes: new Uint8Array(bytes),
        fileName: ctx.fileName,
        kind: ctx.kind,
        dir: this.filesDir,
        logScope: 'wecom',
      })
    } catch (err) {
      log('warn', 'wecom', `download attachment failed: ${errText(err)}`)
      return { ok: false, error: `《${ctx.fileName}》下载/解密失败: ${errText(err)}` }
    }
  }

  /** 回调帧 → 去重 → 解析 → 入队(同步返回) */
  private handleIncoming(frame: WecomFrame, allowGroups: boolean): void {
    if (frame.cmd !== 'aibot_msg_callback') return
    const body = frame.body ?? {}
    const msgId = String((body as { msgid?: unknown }).msgid ?? '')
    if (msgId && this.dedup.has(msgId)) {
      log('info', 'wecom', `duplicate message ${msgId}, skip`)
      return
    }
    const result = parseWecomMessage(body, frame.headers?.req_id ?? '', { allowGroups })
    if (!result) return
    if (msgId) this.dedup.remember(msgId)
    this.rememberDelivery(result.parsed.messageId, result.delivery)

    // 附件立即下载解密(url 5 分钟时效;下载失败不阻塞入队,批内汇总告知)
    for (const att of result.delivery.attachments) {
      void this.downloadAttachment(att).then((r) => {
        if (r.ok) this.pendingAttachments.set(`${result.parsed.messageId}:${att.url}`, r.saved)
        else log('warn', 'wecom', `prefetch attachment failed: ${r.error}`)
      })
    }

    const queue = this.pipeline?.queue
    if (!queue) return
    if (!queue.submit({ parsed: result.parsed })) {
      log('warn', 'wecom', `pending queue full (${queue.pendingCount}), drop message`)
      this.client?.sendCommand('aibot_respond_msg', result.delivery.reqId, {
        msgtype: 'text',
        text: { content: '当前消息处理繁忙,请稍后再发。' },
      })
    }
  }

  /** 预取附件结果(msgId:url → 已落盘),downloadAttachment 批内直取 */
  private readonly pendingAttachments = new Map<string, { name: string; path: string; bytes: number }>()

  private rememberDelivery(msgId: string, delivery: WecomDeliveryInfo): void {
    if (this.deliveries.size >= DELIVERY_CACHE_MAX) {
      const oldest = this.deliveries.keys().next().value
      if (oldest !== undefined) this.deliveries.delete(oldest)
    }
    this.deliveries.set(msgId, delivery)
  }

  private readonly handleSystemResume = (): void => {
    if (!this.client || this.userStopped) return
    log('info', 'wecom', 'system resumed from sleep, forcing ws reconnect')
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
    if (this.pipeline) {
      const { queue, activeSessions } = this.pipeline
      this.pipeline = null
      try {
        await queue.cancelAll()
      } catch (err) {
        log('warn', 'wecom', `queue cancel error: ${errText(err)}`)
      }
      for (const session of activeSessions) {
        try {
          await session.fail('机器人已停止,本次回复已中断,请重新发送消息。')
        } catch {
          /* ignore */
        }
      }
      activeSessions.clear()
    }
    this.client?.stop()
    this.client = null
    this.connectedAt = undefined
    if (this.currentStatus !== 'idle') {
      this.setStatus('idle')
    }
    log('info', 'wecom', 'stopped')
  }

  isUserStopped(): boolean {
    return this.userStopped
  }

  /** 主动推送(aibot_send_msg;「用户先发过消息」前置条件由平台侧校验) */
  sendProactive(chatId: string, text: string): void {
    if (!this.client) throw new Error('企微未连接,无法主动推送')
    const reqId = `${WECOM_CMD.SEND_MSG}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    this.client.sendCommand(WECOM_CMD.SEND_MSG, reqId, {
      chatid: chatId,
      msgtype: 'text',
      text: { content: text },
    })
  }

  private setStatus(
    status: WecomBotStatus,
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

export const wecomBotService = new WecomBotService()
