// =============================================================
// adapters/slack — Slack Socket Mode 薄客户端(apps.connections.open + WS + chat.postMessage)
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
import { SLACK_MANIFEST_ID, slackManifest } from './manifest'

export class SlackChannelAdapter implements ChannelAdapter {
  readonly id = SLACK_MANIFEST_ID
  readonly manifest = slackManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  private lastMessageAt?: number
  private ctx: ChannelRuntimeContext | null = null
  private botToken = ''
  private ws: WebSocket | null = null
  private stopRequested = false
  private botUserId = ''

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    if (!((await ctx.getSecret('botToken')) ?? '').trim()) {
      return { ok: false, message: 'Bot Token(xoxb) 未配置', field: 'botToken' }
    }
    if (!((await ctx.getSecret('appToken')) ?? '').trim()) {
      return { ok: false, message: 'App Token(xapp) 未配置', field: 'appToken' }
    }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.stopRequested = false
    this.botToken = ((await ctx.getSecret('botToken')) ?? '').trim()
    const appToken = ((await ctx.getSecret('appToken')) ?? '').trim()
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    const auth = await jsonFetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    })
    const authBody = auth.json as { ok?: boolean; user_id?: string; error?: string } | null
    if (!auth.ok || !authBody?.ok) {
      const msg = `Slack bot token 无效: ${authBody?.error || auth.text.slice(0, 200)}`
      this.fail(ctx, msg)
      throw new Error(msg)
    }
    this.botUserId = authBody.user_id || ''

    const conn = await jsonFetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    })
    const connBody = conn.json as { ok?: boolean; url?: string; error?: string } | null
    if (!conn.ok || !connBody?.ok || !connBody.url) {
      const msg = `Socket Mode 打开失败: ${connBody?.error || conn.text.slice(0, 200)}(需开启 Socket Mode 并使用 xapp 级别 App Token)`
      this.fail(ctx, msg)
      throw new Error(msg)
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(connBody.url!)
      this.ws = ws
      let ready = false
      ws.on('message', (data) => {
        try {
          const pkt = JSON.parse(String(data)) as {
            type?: string
            envelope_id?: string
            payload?: {
              event?: {
                type?: string
                text?: string
                user?: string
                channel?: string
                channel_type?: string
                ts?: string
                bot_id?: string
                subtype?: string
              }
            }
          }
          if (pkt.type === 'hello') {
            ready = true
            this.status = 'connected'
            this.connectedAt = Date.now()
            this.detail = proxyHint(String(ctx.config.proxyUrl ?? ''))
            ctx.bridge.onStatus({
              status: 'connected',
              connectedAt: this.connectedAt,
              detail: this.detail,
            })
            resolve()
            return
          }
          if (pkt.envelope_id) {
            ws.send(JSON.stringify({ envelope_id: pkt.envelope_id }))
          }
          const ev = pkt.payload?.event
          if (!ev || ev.type !== 'message' || ev.bot_id || ev.subtype) return
          if (ev.user && ev.user === this.botUserId) return
          if (!ev.text?.trim() || !ev.channel) return
          const inbound: InboundMessage = {
            channel: this.id,
            providerMessageId: ev.ts || `${ev.channel}:${Date.now()}`,
            chat: {
              id: ev.channel,
              type: ev.channel_type === 'im' ? 'p2p' : 'group',
            },
            sender: { id: ev.user || 'unknown' },
            text: ev.text,
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
        } catch (err) {
          log('warn', 'slack', `ws parse: ${err instanceof Error ? err.message : err}`)
        }
      })
      ws.on('error', (err: unknown) => {
        if (!ready) reject(err instanceof Error ? err : new Error(String(err)))
        else this.fail(ctx, err instanceof Error ? err.message : String(err))
      })
      ws.on('close', () => {
        if (!this.stopRequested && ready) {
          this.fail(ctx, 'Slack Socket Mode 已断开')
        }
        if (!ready) reject(new Error('Slack WS 在 hello 前关闭'))
      })
      setTimeout(() => {
        if (!ready) reject(new Error('Slack Socket Mode 连接超时'))
      }, 20_000)
    })
    log('info', 'slack', 'socket mode connected')
  }

  private fail(ctx: ChannelRuntimeContext, msg: string): void {
    this.status = 'error'
    this.detail = msg
    ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
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
    if (!this.botToken) throw new Error('Slack 未连接')
    const channel = target.chatId
    if (!channel) throw new Error('缺少 channel')
    const res = await jsonFetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text: outboundText(content) }),
    })
    const body = res.json as { ok?: boolean; ts?: string; error?: string } | null
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || res.text.slice(0, 200) || `HTTP ${res.status}`)
    }
    return { messageId: body.ts }
  }
}

export function createSlackAdapter(): ChannelAdapter {
  return new SlackChannelAdapter()
}

export { slackManifest, SLACK_MANIFEST_ID }
