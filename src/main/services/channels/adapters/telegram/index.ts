// =============================================================
// adapters/telegram — Telegram Bot 薄客户端(getUpdates 长轮询 + sendMessage)
// =============================================================

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
import { jsonFetch, outboundText, proxyHint } from '../_shared/bot-http'
import { TELEGRAM_MANIFEST_ID, telegramManifest } from './manifest'

type TgUpdate = {
  update_id: number
  message?: {
    message_id: number
    text?: string
    chat: { id: number; type: string; title?: string }
    from?: { id: number; username?: string; first_name?: string }
  }
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly id = TELEGRAM_MANIFEST_ID
  readonly manifest = telegramManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  private lastMessageAt?: number
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: connect() 写入、异步收包回调读取,规则误报
  private ctx: ChannelRuntimeContext | null = null
  private token = ''
  private apiBase = 'https://api.telegram.org'
  private offset = 0
  private stopRequested = false
  private loopPromise: Promise<void> | null = null

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const token = ((await ctx.getSecret('botToken')) ?? '').trim()
    if (!token) return { ok: false, message: 'Bot Token 未配置', field: 'botToken' }
    return { ok: true }
  }

  private api(method: string): string {
    return `${this.apiBase}/bot${this.token}/${method}`
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.stopRequested = false
    this.token = ((await ctx.getSecret('botToken')) ?? '').trim()
    this.apiBase = String(ctx.config.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '')
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    const me = await jsonFetch(this.api('getMe'))
    const ok = (me.json as { ok?: boolean } | null)?.ok
    if (!me.ok || !ok) {
      const msg = `Telegram Token 校验失败: ${me.text.slice(0, 200)}`
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
    this.loopPromise = this.pollLoop(ctx)
    log('info', 'telegram', 'long-poll started')
  }

  private async pollLoop(ctx: ChannelRuntimeContext): Promise<void> {
    while (!this.stopRequested) {
      try {
        const res = await jsonFetch(`${this.api('getUpdates')}?timeout=25&offset=${this.offset}`, {
          timeoutMs: 35_000,
        })
        const body = res.json as { ok?: boolean; result?: TgUpdate[] } | null
        if (!res.ok || !body?.ok) {
          throw new Error(res.text.slice(0, 200) || `HTTP ${res.status}`)
        }
        for (const u of body.result ?? []) {
          this.offset = u.update_id + 1
          const m = u.message
          if (!m?.text) continue
          const chatType = m.chat.type === 'private' ? 'p2p' : 'group'
          const inbound: InboundMessage = {
            channel: this.id,
            providerMessageId: String(m.message_id),
            chat: { id: String(m.chat.id), type: chatType },
            sender: {
              id: String(m.from?.id ?? m.chat.id),
              name: m.from?.username || m.from?.first_name,
            },
            text: m.text,
            attachments: [],
            receivedAt: Date.now(),
            raw: u,
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
        if (this.stopRequested) return
        const msg = err instanceof Error ? err.message : String(err)
        log('warn', 'telegram', `poll error: ${msg}`)
        this.detail = `长轮询异常,将重试: ${msg}`
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

  async createReplySession(msg: InboundMessage, placeholderText: string): Promise<ReplySession> {
    const sent = await this.sendReply(msg, { kind: 'text', text: placeholderText })
    const messageId = sent.messageId
    const chatId = msg.chat.id
    let closed = false
    const edit = async (text: string) => {
      if (closed || !messageId) return
      await jsonFetch(this.api('editMessageText'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
          text: text.slice(0, 4096),
        }),
      })
    }
    return {
      update: async (fullText) => edit(fullText),
      finalize: async (finalText) => {
        await edit(finalText)
        closed = true
      },
      fail: async (errorText) => {
        await edit(errorText)
        closed = true
      },
    }
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    if (!this.token) throw new Error('Telegram 未连接')
    const chatId = target.chatId
    if (!chatId) throw new Error('缺少 chatId')
    const res = await jsonFetch(this.api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: outboundText(content).slice(0, 4096),
      }),
    })
    const body = res.json as {
      ok?: boolean
      result?: { message_id?: number }
      description?: string
    } | null
    if (!res.ok || !body?.ok) {
      throw new Error(body?.description || res.text.slice(0, 200) || `HTTP ${res.status}`)
    }
    return {
      messageId: body.result?.message_id != null ? String(body.result.message_id) : undefined,
    }
  }
}

export function createTelegramAdapter(): ChannelAdapter {
  return new TelegramChannelAdapter()
}

export { TELEGRAM_MANIFEST_ID, telegramManifest }
