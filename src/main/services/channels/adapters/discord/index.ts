// =============================================================
// adapters/discord — Discord Bot 薄客户端(Gateway WS + REST)
// 官方 Bot Token;国内常需系统代理。Message Content Intent 须在开发者后台开启。
// =============================================================

import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import WebSocket from 'ws'
import { log } from '../../../../utils/logger'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { jsonFetch, outboundText, proxyHint } from '../_shared/bot-http'
import { DISCORD_MANIFEST_ID, discordManifest } from './manifest'

const API = 'https://discord.com/api/v10'
const INTENTS = (1 << 9) | (1 << 12) | (1 << 15) // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly id = DISCORD_MANIFEST_ID
  readonly manifest = discordManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: connect() 写入、异步收包回调读取,规则误报
  private ctx: ChannelRuntimeContext | null = null
  private lastMessageAt?: number
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sequence: number | null = null
  private token = ''
  private stopRequested = false

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const token = ((await ctx.getSecret('botToken')) ?? '').trim()
    if (!token) return { ok: false, message: 'Bot Token 未配置', field: 'botToken' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.stopRequested = false
    this.token = ((await ctx.getSecret('botToken')) ?? '').trim()
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    const me = await jsonFetch(`${API}/users/@me`, {
      headers: { Authorization: `Bot ${this.token}` },
    })
    if (!me.ok) {
      const msg = `Discord Token 校验失败 HTTP ${me.status}: ${me.text.slice(0, 200)}`
      this.fail(ctx, msg)
      throw new Error(msg)
    }

    const gw = await jsonFetch(`${API}/gateway`)
    const url =
      typeof (gw.json as { url?: string } | null)?.url === 'string'
        ? `${(gw.json as { url: string }).url}/?v=10&encoding=json`
        : 'wss://gateway.discord.gg/?v=10&encoding=json'

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      let identified = false
      ws.on('open', () => log('info', 'discord', 'gateway open'))
      ws.on('message', (data) => {
        try {
          const pkt = JSON.parse(String(data)) as {
            op: number
            d?: unknown
            s?: number | null
            t?: string | null
          }
          if (typeof pkt.s === 'number') this.sequence = pkt.s
          if (pkt.op === 10) {
            const hi = (pkt.d as { heartbeat_interval: number }).heartbeat_interval
            this.startHeartbeat(hi)
            ws.send(
              JSON.stringify({
                op: 2,
                d: {
                  token: this.token,
                  intents: INTENTS,
                  properties: {
                    os: 'windows',
                    browser: 'education-advisor',
                    device: 'education-advisor',
                  },
                },
              }),
            )
          } else if (pkt.op === 0 && pkt.t === 'READY') {
            identified = true
            this.status = 'connected'
            this.connectedAt = Date.now()
            const hint = proxyHint(String(ctx.config.proxyUrl ?? ''))
            this.detail = hint
            ctx.bridge.onStatus({
              status: 'connected',
              connectedAt: this.connectedAt,
              detail: this.detail,
            })
            resolve()
          } else if (pkt.op === 0 && pkt.t === 'MESSAGE_CREATE') {
            this.onMessageCreate(ctx, pkt.d as Record<string, unknown>)
          } else if (pkt.op === 9) {
            reject(new Error('Discord IDENTIFY 被拒绝(invalid session)'))
          }
        } catch (err) {
          log('warn', 'discord', `gateway parse: ${err instanceof Error ? err.message : err}`)
        }
      })
      ws.on('error', (err: unknown) => {
        if (!identified) reject(err instanceof Error ? err : new Error(String(err)))
        else {
          const msg = err instanceof Error ? err.message : String(err)
          this.status = 'error'
          this.detail = msg
          ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
        }
      })
      ws.on('close', () => {
        this.clearHeartbeat()
        if (!this.stopRequested && identified) {
          this.status = 'error'
          this.detail = 'Discord Gateway 已断开'
          ctx.bridge.onStatus({ status: 'error', detail: this.detail, lastErrorAt: Date.now() })
        }
        if (!identified) reject(new Error('Discord Gateway 在 READY 前关闭'))
      })
      setTimeout(() => {
        if (!identified) reject(new Error('Discord Gateway 连接超时'))
      }, 20_000)
    })
  }

  private onMessageCreate(ctx: ChannelRuntimeContext, d: Record<string, unknown>): void {
    if (d.author && typeof d.author === 'object' && (d.author as { bot?: boolean }).bot) return
    const content = typeof d.content === 'string' ? d.content : ''
    if (!content.trim()) return
    const author = d.author as { id?: string; username?: string } | undefined
    const channelId = String(d.channel_id ?? '')
    const guildId = d.guild_id ? String(d.guild_id) : ''
    const inbound: InboundMessage = {
      channel: this.id,
      providerMessageId: String(d.id ?? `${channelId}:${Date.now()}`),
      chat: { id: channelId, type: guildId ? 'group' : 'p2p' },
      sender: { id: String(author?.id ?? 'unknown'), name: author?.username },
      text: content,
      attachments: [],
      receivedAt: Date.now(),
      raw: d,
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

  private startHeartbeat(interval: number): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.sequence }))
    }, interval)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private fail(ctx: ChannelRuntimeContext, msg: string): void {
    this.status = 'error'
    this.detail = msg
    ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true
    this.clearHeartbeat()
    const ws = this.ws
    this.ws = null
    try {
      ws?.close()
    } catch {
      // ignore
    }
    this.ctx = null
    this.status = 'disabled'
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
    if (!this.token) throw new Error('Discord 未连接')
    const channelId = target.chatId
    if (!channelId) throw new Error('缺少 channelId')
    const res = await jsonFetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: outboundText(content).slice(0, 2000) }),
    })
    if (!res.ok) throw new Error(`Discord 发送失败 HTTP ${res.status}: ${res.text.slice(0, 200)}`)
    const id = (res.json as { id?: string } | null)?.id
    return { messageId: id }
  }
}

export function createDiscordAdapter(): ChannelAdapter {
  return new DiscordChannelAdapter()
}

export { DISCORD_MANIFEST_ID, discordManifest }
