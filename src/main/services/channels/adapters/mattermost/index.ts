// =============================================================
// adapters/mattermost — Mattermost 薄客户端(WS + REST posts)
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
import { MATTERMOST_MANIFEST_ID, mattermostManifest } from './manifest'

export class MattermostChannelAdapter implements ChannelAdapter {
  readonly id = MATTERMOST_MANIFEST_ID
  readonly manifest = mattermostManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  private lastMessageAt?: number
  private ctx: ChannelRuntimeContext | null = null
  private baseUrl = ''
  private botToken = ''
  private botUserId = ''
  private ws: WebSocket | null = null
  private seq = 1
  private stopRequested = false

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    if (!String(ctx.config.baseUrl ?? '').trim()) {
      return { ok: false, message: '服务器 URL 未填写', field: 'baseUrl' }
    }
    if (!((await ctx.getSecret('botToken')) ?? '').trim()) {
      return { ok: false, message: 'Bot Token 未配置', field: 'botToken' }
    }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.stopRequested = false
    this.baseUrl = String(ctx.config.baseUrl ?? '').replace(/\/$/, '')
    this.botToken = ((await ctx.getSecret('botToken')) ?? '').trim()
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    const me = await jsonFetch(`${this.baseUrl}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${this.botToken}` },
    })
    if (!me.ok) {
      const msg = `Mattermost Token 校验失败 HTTP ${me.status}: ${me.text.slice(0, 200)}`
      this.fail(ctx, msg)
      throw new Error(msg)
    }
    this.botUserId = String((me.json as { id?: string } | null)?.id ?? '')

    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/v4/websocket'
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${this.botToken}` },
      })
      this.ws = ws
      let authed = false
      ws.on('open', () => {
        // 部分部署靠 header;再发 authentication challenge 兼容
        ws.send(
          JSON.stringify({
            seq: this.seq++,
            action: 'authentication_challenge',
            data: { token: this.botToken },
          }),
        )
      })
      ws.on('message', (data) => {
        try {
          const pkt = JSON.parse(String(data)) as {
            event?: string
            status?: string
            data?: {
              post?: string
              user_id?: string
            }
          }
          if (pkt.event === 'hello' || pkt.status === 'OK') {
            if (!authed) {
              authed = true
              this.status = 'connected'
              this.connectedAt = Date.now()
              this.detail = proxyHint(String(ctx.config.proxyUrl ?? ''))
              ctx.bridge.onStatus({
                status: 'connected',
                connectedAt: this.connectedAt,
                detail: this.detail,
              })
              resolve()
            }
          }
          if (pkt.event === 'posted' && pkt.data?.post) {
            let post: {
              id?: string
              message?: string
              user_id?: string
              channel_id?: string
            }
            try {
              post = JSON.parse(pkt.data.post)
            } catch {
              return
            }
            if (!post.message?.trim()) return
            if (post.user_id && post.user_id === this.botUserId) return
            const inbound: InboundMessage = {
              channel: this.id,
              providerMessageId: post.id || `${post.channel_id}:${Date.now()}`,
              chat: { id: String(post.channel_id ?? ''), type: 'group' },
              sender: { id: String(post.user_id ?? 'unknown') },
              text: post.message,
              attachments: [],
              receivedAt: Date.now(),
              raw: post,
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
        } catch (err) {
          log('warn', 'mattermost', `ws parse: ${err instanceof Error ? err.message : err}`)
        }
      })
      ws.on('error', (err: unknown) => {
        if (!authed) reject(err instanceof Error ? err : new Error(String(err)))
        else this.fail(ctx, err instanceof Error ? err.message : String(err))
      })
      ws.on('close', () => {
        if (!this.stopRequested && authed) this.fail(ctx, 'Mattermost WS 已断开')
        if (!authed) reject(new Error('Mattermost WS 在认证前关闭'))
      })
      setTimeout(() => {
        if (!authed) reject(new Error('Mattermost WS 连接超时'))
      }, 20_000)
    })
    log('info', 'mattermost', `connected ${this.baseUrl}`)
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
    if (!this.botToken) throw new Error('Mattermost 未连接')
    const channel_id = target.chatId
    if (!channel_id) throw new Error('缺少 channel_id')
    const res = await jsonFetch(`${this.baseUrl}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel_id, message: outboundText(content) }),
    })
    if (!res.ok) throw new Error(`Mattermost 发送失败 HTTP ${res.status}: ${res.text.slice(0, 200)}`)
    return { messageId: (res.json as { id?: string } | null)?.id }
  }
}

export function createMattermostAdapter(): ChannelAdapter {
  return new MattermostChannelAdapter()
}

export { mattermostManifest, MATTERMOST_MANIFEST_ID }
