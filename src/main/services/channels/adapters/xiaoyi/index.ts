// =============================================================
// adapters/xiaoyi — 华为小艺云 A2A dual-WS client
// Port from QwenPaw xiaoyi/ (primary+backup, heartbeat, AK/SK headers)
// =============================================================

import { randomUUID } from 'node:crypto'
import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
  ReplySession,
} from '@shared/types'
import { log } from '../../../../utils/logger'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { checkAcl, policyFromConfig, type AclPolicy } from '../_shared/acl'
import { HealthTracker } from '../_shared/health'
import { createBackoffState, nextBackoffDelay, resetBackoff } from '../_shared/reconnect'
import { XiaoyiConnection } from './connection'
import {
  DEFAULT_WS_URL,
  DEFAULT_WS_URL_BACKUP,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAYS_MS,
  TEXT_CHUNK_LIMIT,
} from './constants'
import { XIAOYI_MANIFEST_ID, xiaoyiManifest } from './manifest'

function outboundText(content: OutboundContent): string {
  return content.kind === 'text' || content.kind === 'markdown' ? content.text : ''
}

function chunkText(text: string, limit = TEXT_CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit))
  return out
}

export class XiaoyiChannelAdapter implements ChannelAdapter {
  readonly id = XIAOYI_MANIFEST_ID
  readonly manifest = xiaoyiManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private ctx: ChannelRuntimeContext | null = null
  private ak = ''
  private sk = ''
  private agentId = ''
  private primary: XiaoyiConnection | null = null
  private backup: XiaoyiConnection | null = null
  private stopping = false
  private backoff = createBackoffState({
    delaysMs: RECONNECT_DELAYS_MS,
    maxAttempts: MAX_RECONNECT_ATTEMPTS,
  })
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private sessionServer = new Map<string, string>()
  private sessionTask = new Map<string, string>()
  private acl: AclPolicy = { dm: 'open', group: 'open', allowFrom: [] }
  private health = new HealthTracker()

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    if (!String(ctx.config.accessKey ?? '').trim()) {
      return { ok: false, message: 'Access Key 未填写', field: 'accessKey' }
    }
    if (!((await ctx.getSecret('secretKey')) ?? '').trim()) {
      return { ok: false, message: 'Secret Key 未配置', field: 'secretKey' }
    }
    if (!String(ctx.config.agentId ?? '').trim()) {
      return { ok: false, message: 'Agent ID 未填写', field: 'agentId' }
    }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.stopping = false
    this.acl = policyFromConfig(ctx.config)
    this.ak = String(ctx.config.accessKey ?? '').trim()
    this.sk = ((await ctx.getSecret('secretKey')) ?? '').trim()
    this.agentId = String(ctx.config.agentId ?? '').trim()
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'
    this.health.status = 'connecting'

    const ok = await this.startConnections()
    if (!ok) {
      const msg =
        '小艺 A2A 双链路均未连上(primary+backup)。请检查 AK/SK/agentId 与网络；IP 备份链路会跳过 TLS CN 校验。'
      this.status = 'error'
      this.detail = msg
      this.health.setError(msg)
      ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
      throw new Error(msg)
    }
    resetBackoff(this.backoff)
    this.status = 'connected'
    this.detail = this.connectionDetail()
    this.health.markConnected(this.detail)
    ctx.bridge.onStatus({
      status: 'connected',
      connectedAt: this.health.connectedAt,
      detail: this.detail,
    })
    log('info', 'xiaoyi', this.detail)
  }

  private connectionDetail(): string {
    const p = this.primary?.connected ? 'primary✓' : 'primary✗'
    const b = this.backup?.connected ? 'backup✓' : 'backup✗'
    return `A2A dual-WS ${p} ${b}, agent=${this.agentId}`
  }

  private async startConnections(): Promise<boolean> {
    const wsUrl = String(this.ctx?.config.wsUrl ?? DEFAULT_WS_URL).trim() || DEFAULT_WS_URL
    const backupUrl =
      String(this.ctx?.config.wsUrlBackup ?? DEFAULT_WS_URL_BACKUP).trim() || DEFAULT_WS_URL_BACKUP

    await this.primary?.disconnect()
    await this.backup?.disconnect()

    const logFn = (level: 'info' | 'warn' | 'error', msg: string) =>
      log(level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info', 'xiaoyi', msg)

    this.primary = new XiaoyiConnection({
      serverName: 'primary',
      wsUrl,
      ak: this.ak,
      sk: this.sk,
      agentId: this.agentId,
      onMessage: (m, s) => this.handleIncoming(m, s),
      onDisconnect: (s) => this.handleDisconnect(s),
      log: logFn,
    })
    this.backup = new XiaoyiConnection({
      serverName: 'backup',
      wsUrl: backupUrl,
      ak: this.ak,
      sk: this.sk,
      agentId: this.agentId,
      onMessage: (m, s) => this.handleIncoming(m, s),
      onDisconnect: (s) => this.handleDisconnect(s),
      log: logFn,
    })

    const [a, b] = await Promise.all([this.primary.connect(), this.backup.connect()])
    return a || b
  }

  private handleDisconnect(serverName: string): void {
    if (this.stopping) return
    log('warn', 'xiaoyi', `disconnected: ${serverName}`)
    for (const [sid, srv] of [...this.sessionServer.entries()]) {
      if (srv === serverName) this.sessionServer.delete(sid)
    }
    const c1 = this.primary?.connected
    const c2 = this.backup?.connected
    if (!c1 && !c2) {
      this.status = 'connecting'
      this.detail = '双链路断开,重连中…'
      this.ctx?.bridge.onStatus({
        status: 'connecting',
        detail: this.detail,
        reconnectAttempt: this.backoff.attempts + 1,
      })
      this.scheduleReconnect()
    } else {
      this.detail = this.connectionDetail()
      this.ctx?.bridge.onStatus({
        status: 'connected',
        connectedAt: this.health.connectedAt,
        detail: this.detail,
        degraded: true,
      })
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return
    const delay = nextBackoffDelay(this.backoff)
    if (delay == null) {
      this.status = 'error'
      this.detail = '小艺重连次数耗尽'
      this.health.setError(this.detail)
      this.ctx?.bridge.onStatus({ status: 'error', detail: this.detail, lastErrorAt: Date.now() })
      return
    }
    this.health.reconnectAttempt = this.backoff.attempts
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.startConnections().then((ok) => {
        if (ok) {
          resetBackoff(this.backoff)
          this.status = 'connected'
          this.detail = this.connectionDetail()
          this.health.markConnected(this.detail)
          this.ctx?.bridge.onStatus({
            status: 'connected',
            connectedAt: this.health.connectedAt,
            detail: this.detail,
          })
        } else {
          this.scheduleReconnect()
        }
      })
    }, delay)
  }

  private handleIncoming(message: Record<string, unknown>, serverName: string): void {
    if (this.stopping || !this.ctx) return
    this.health.inc('inbound_frames')

    if (message.agentId && String(message.agentId) !== this.agentId) {
      log('warn', 'xiaoyi', `agentId mismatch ${message.agentId}`)
      return
    }

    const params = (message.params as Record<string, unknown> | undefined) ?? {}
    const sessionId = String(params.sessionId ?? message.sessionId ?? '')
    if (sessionId) this.sessionServer.set(sessionId, serverName)

    const method = String(message.method ?? message.action ?? '')
    if (method === 'clearContext' || method === 'clear') {
      void this.sendClearResponse(String(message.id ?? ''), sessionId)
      if (sessionId) this.sessionTask.delete(sessionId)
      return
    }
    if (method === 'tasks/cancel') {
      void this.sendCancelResponse(String(message.id ?? ''), sessionId)
      return
    }
    if (method !== 'message/stream') return

    const taskId = String(params.id ?? message.id ?? '')
    if (sessionId && taskId) this.sessionTask.set(sessionId, taskId)

    const msg = (params.message as Record<string, unknown> | undefined) ?? {}
    const parts = Array.isArray(msg.parts) ? (msg.parts as Array<Record<string, unknown>>) : []
    const texts: string[] = []
    for (const part of parts) {
      if (part.kind === 'text' && typeof part.text === 'string') texts.push(part.text)
    }
    const text = texts.join(' ').trim()
    if (!text || !sessionId) return

    const acl = checkAcl(this.acl, { chatType: 'p2p', senderId: sessionId, chatId: sessionId })
    if (acl.decision !== 'allow') {
      this.health.inc(`acl_${acl.decision}`)
      return
    }

    const inbound: InboundMessage = {
      channel: this.id,
      providerMessageId: String(message.id ?? taskId ?? randomUUID()),
      chat: { id: sessionId, type: 'p2p' },
      sender: { id: sessionId },
      text,
      attachments: [],
      receivedAt: Date.now(),
      raw: message,
    }
    this.health.lastMessageAt = Date.now()
    this.health.inc('inbound')
    this.ctx.bridge.onMessage(inbound)
    this.ctx.bridge.onStatus({
      status: 'connected',
      connectedAt: this.health.connectedAt,
      lastMessageAt: this.health.lastMessageAt,
      detail: this.detail,
    })
  }

  private sendToSession(sessionId: string, msg: Record<string, unknown>): boolean {
    const target = this.sessionServer.get(sessionId) ?? 'primary'
    if (target === 'backup') {
      if (this.backup?.sendJson(msg)) return true
      if (this.primary?.sendJson(msg)) return true
    } else {
      if (this.primary?.sendJson(msg)) return true
      if (this.backup?.sendJson(msg)) return true
    }
    return false
  }

  private buildAgentResponse(
    sessionId: string,
    taskId: string,
    jsonRpc: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      msgType: 'agent_response',
      agentId: this.agentId,
      sessionId,
      taskId,
      msgDetail: JSON.stringify(jsonRpc),
    }
  }

  private sendClearResponse(requestId: string, sessionId: string): void {
    const msg = this.buildAgentResponse(sessionId, requestId, {
      jsonrpc: '2.0',
      id: requestId,
      result: { status: { state: 'cleared' } },
    })
    this.sendToSession(sessionId, msg)
  }

  private sendCancelResponse(requestId: string, sessionId: string): void {
    const msg = this.buildAgentResponse(sessionId, requestId, {
      jsonrpc: '2.0',
      id: requestId,
      result: { id: requestId, status: { state: 'canceled' } },
    })
    this.sendToSession(sessionId, msg)
  }

  private sendChunk(
    sessionId: string,
    taskId: string,
    messageId: string,
    text: string,
    append: boolean,
    final: boolean,
  ): boolean {
    const artifact = {
      artifactId: messageId,
      name: 'response',
      parts: [{ kind: 'text', text }],
    }
    const jsonRpc = {
      jsonrpc: '2.0',
      id: taskId,
      result: {
        id: taskId,
        status: { state: final ? 'completed' : 'working' },
        artifact,
        append,
        lastChunk: final,
      },
    }
    return this.sendToSession(sessionId, this.buildAgentResponse(sessionId, taskId, jsonRpc))
  }

  async disconnect(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    await this.primary?.disconnect()
    await this.backup?.disconnect()
    this.primary = null
    this.backup = null
    this.ctx = null
    this.status = 'disabled'
    this.detail = undefined
    this.health.reset()
  }

  getStatus() {
    return {
      status: this.status,
      detail: this.detail,
      connectedAt: this.health.connectedAt,
      lastMessageAt: this.health.lastMessageAt,
      lastErrorAt: this.health.lastErrorAt,
      reconnectAttempt: this.health.reconnectAttempt,
    }
  }

  getAccessPolicy() {
    return {
      dm: this.acl.dm === 'allowlist' ? ('allowlist' as const) : ('open' as const),
      group: this.acl.group === 'allowlist' ? ('allowlist' as const) : ('open' as const),
      allowFrom: this.acl.allowFrom,
      requireMention: Boolean(this.acl.requireMention),
    }
  }

  getHealthDiagnostics() {
    return this.health.snapshot()
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    const text = outboundText(content)
    if (!text.trim()) return {}
    const sessionId = msg.chat.id
    const taskId = this.sessionTask.get(sessionId)
    if (!taskId) throw new Error(`小艺无 task_id: session=${sessionId}`)
    const messageId = randomUUID()
    const chunks = chunkText(text)
    for (let i = 0; i < chunks.length; i++) {
      const final = i === chunks.length - 1
      const ok = this.sendChunk(sessionId, taskId, messageId, chunks[i]!, i > 0, final)
      if (!ok) throw new Error('小艺发送失败: 无可用 WS')
      this.health.inc('outbound')
    }
    // Final close artifact (A2A expects completed state)
    this.sendChunk(sessionId, taskId, messageId, '', true, true)
    return { messageId }
  }

  async push(_target: PushTarget, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('小艺 A2A 不支持无会话主动推送(需既有 session/task)')
  }

  async createReplySession(msg: InboundMessage, placeholderText: string): Promise<ReplySession> {
    const sessionId = msg.chat.id
    const taskId = this.sessionTask.get(sessionId)
    if (!taskId) throw new Error(`小艺无 task_id: session=${sessionId}`)
    const messageId = randomUUID()
    let closed = false
    if (placeholderText) {
      this.sendChunk(sessionId, taskId, messageId, placeholderText, false, false)
    }
    return {
      update: async (fullText: string) => {
        if (closed) return
        this.sendChunk(sessionId, taskId, messageId, fullText, false, false)
      },
      finalize: async (finalText: string) => {
        if (closed) return
        closed = true
        this.sendChunk(sessionId, taskId, messageId, finalText, false, true)
      },
      fail: async (errorText: string) => {
        if (closed) return
        closed = true
        this.sendChunk(sessionId, taskId, messageId, errorText, false, true)
      },
    }
  }
}

export function createXiaoyiAdapter(): ChannelAdapter {
  return new XiaoyiChannelAdapter()
}

export { xiaoyiManifest, XIAOYI_MANIFEST_ID }
export { generateAuthHeaders, generateSignature } from './auth'
