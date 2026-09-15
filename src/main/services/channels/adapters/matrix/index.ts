// =============================================================
// adapters/matrix — Matrix Client-Server 薄客户端(/sync 长轮询 + 发消息)
// =============================================================

import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import { log } from '../../../../utils/logger'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { jsonFetch, outboundText, proxyHint } from '../_shared/bot-http'
import { MATRIX_MANIFEST_ID, matrixManifest } from './manifest'

export class MatrixChannelAdapter implements ChannelAdapter {
  readonly id = MATRIX_MANIFEST_ID
  readonly manifest = matrixManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: connect() 写入、异步收包回调读取,规则误报
  private ctx: ChannelRuntimeContext | null = null
  private lastMessageAt?: number
  private homeserver = ''
  private userId = ''
  private accessToken = ''
  private since = ''
  private stopRequested = false
  private loopPromise: Promise<void> | null = null

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    if (!String(ctx.config.homeserver ?? '').trim()) {
      return { ok: false, message: 'Homeserver URL 未填写', field: 'homeserver' }
    }
    if (!String(ctx.config.userId ?? '').trim()) {
      return { ok: false, message: 'User ID 未填写', field: 'userId' }
    }
    if (!((await ctx.getSecret('accessToken')) ?? '').trim()) {
      return { ok: false, message: 'Access Token 未配置', field: 'accessToken' }
    }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.stopRequested = false
    this.homeserver = String(ctx.config.homeserver ?? '').replace(/\/$/, '')
    this.userId = String(ctx.config.userId ?? '').trim()
    this.accessToken = ((await ctx.getSecret('accessToken')) ?? '').trim()
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    const whoami = await jsonFetch(`${this.homeserver}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!whoami.ok) {
      const msg = `Matrix Token 校验失败 HTTP ${whoami.status}: ${whoami.text.slice(0, 200)}`
      this.status = 'error'
      this.detail = msg
      ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
      throw new Error(msg)
    }

    this.status = 'connected'
    this.connectedAt = Date.now()
    this.detail = proxyHint(String(ctx.config.proxyUrl ?? ''))
    ctx.bridge.onStatus({
      status: 'connected',
      connectedAt: this.connectedAt,
      detail: this.detail,
    })
    this.loopPromise = this.syncLoop(ctx)
    log('info', 'matrix', `sync started as ${this.userId}`)
  }

  private async syncLoop(ctx: ChannelRuntimeContext): Promise<void> {
    while (!this.stopRequested) {
      try {
        const q = new URLSearchParams({
          timeout: '30000',
          ...(this.since ? { since: this.since } : {}),
        })
        const res = await jsonFetch(`${this.homeserver}/_matrix/client/v3/sync?${q}`, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          timeoutMs: 45_000,
        })
        if (!res.ok) throw new Error(`sync HTTP ${res.status}: ${res.text.slice(0, 200)}`)
        const body = res.json as {
          next_batch?: string
          rooms?: {
            join?: Record<
              string,
              {
                timeline?: {
                  events?: Array<{
                    type?: string
                    event_id?: string
                    sender?: string
                    content?: { body?: string; msgtype?: string }
                  }>
                }
              }
            >
          }
        } | null
        if (body?.next_batch) this.since = body.next_batch
        const joins = body?.rooms?.join ?? {}
        for (const [roomId, room] of Object.entries(joins)) {
          for (const ev of room.timeline?.events ?? []) {
            if (ev.type !== 'm.room.message') continue
            if (ev.sender === this.userId) continue
            if (ev.content?.msgtype !== 'm.text') continue
            const text = ev.content?.body
            if (!text?.trim()) continue
            const inbound: InboundMessage = {
              channel: this.id,
              providerMessageId: ev.event_id || `${roomId}:${Date.now()}`,
              chat: { id: roomId, type: 'group' },
              sender: { id: ev.sender || 'unknown' },
              text,
              attachments: [],
              receivedAt: Date.now(),
              raw: ev,
            }
            this.lastMessageAt = Date.now()
            ctx.bridge.onMessage(inbound)
            ctx.bridge.onStatus({
              status: 'connected',
              connectedAt: this.connectedAt,
              lastMessageAt: this.lastMessageAt,
              detail: this.detail,
            })
          }
        }
      } catch (err) {
        if (this.stopRequested) return
        const msg = err instanceof Error ? err.message : String(err)
        log('warn', 'matrix', `sync error: ${msg}`)
        this.detail = `sync 异常,将重试: ${msg}`
        ctx.bridge.onStatus({
          status: 'connected',
          connectedAt: this.connectedAt,
          detail: this.detail,
          degraded: true,
          lastErrorAt: Date.now(),
        })
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true
    this.ctx = null
    this.status = 'disabled'
    await this.loopPromise?.catch(() => undefined)
    this.loopPromise = null
  }

  getStatus() {
    return {
      status: this.status,
      detail: this.detail,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
    }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    return this.push({ chatId: msg.chat.id }, content)
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    if (!this.accessToken) throw new Error('Matrix 未连接')
    const roomId = target.chatId
    if (!roomId) throw new Error('缺少 roomId')
    const txnId = `ea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const encRoom = encodeURIComponent(roomId)
    const res = await jsonFetch(
      `${this.homeserver}/_matrix/client/v3/rooms/${encRoom}/send/m.room.message/${txnId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ msgtype: 'm.text', body: outboundText(content) }),
      },
    )
    if (!res.ok) throw new Error(`Matrix 发送失败 HTTP ${res.status}: ${res.text.slice(0, 200)}`)
    const eventId = (res.json as { event_id?: string } | null)?.event_id
    return { messageId: eventId }
  }
}

export function createMatrixAdapter(): ChannelAdapter {
  return new MatrixChannelAdapter()
}

export { MATRIX_MANIFEST_ID, matrixManifest }
