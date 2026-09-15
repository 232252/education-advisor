// =============================================================
// adapters/email — 邮件薄客户端(SMTP 发信 + IMAP IDLE/轮询收信)
// 依赖: nodemailer(出站) + imapflow(入站)。缺依赖时给出可读错误。
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
import { EMAIL_MANIFEST_ID, emailManifest } from './manifest'

type ImapFlowLike = {
  connect(): Promise<void>
  logout(): Promise<void>
  mailboxOpen(path: string): Promise<{ exists?: number; uidNext?: number }>
  idle(): Promise<void>
  fetch(
    range: string | { uid: string },
    opts: Record<string, unknown>,
  ): AsyncIterable<{
    uid: number
    envelope?: {
      messageId?: string
      subject?: string
      from?: Array<{ address?: string; name?: string }>
    }
    source?: Buffer
  }>
  messageFlagsAdd(uid: number | string, flags: string[]): Promise<boolean>
  on(event: string, cb: (...args: unknown[]) => void): void
  usable: boolean
}

export class EmailChannelAdapter implements ChannelAdapter {
  readonly id = EMAIL_MANIFEST_ID
  readonly manifest = emailManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  private lastMessageAt?: number
  private ctx: ChannelRuntimeContext | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private imap: ImapFlowLike | null = null
  private idleAbort = false
  private seenUids = new Set<number>()
  private inboundMode: 'idle' | 'poll' | 'smtp-only' = 'smtp-only'

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    for (const field of ['imapHost', 'smtpHost', 'username'] as const) {
      if (!String(ctx.config[field] ?? '').trim()) {
        return { ok: false, message: `${field} 未填写`, field }
      }
    }
    const password = ((await ctx.getSecret('password')) ?? '').trim()
    if (!password) return { ok: false, message: '授权码/密码未配置', field: 'password' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.idleAbort = false
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    const password = ((await ctx.getSecret('password')) ?? '').trim()
    try {
      const nodemailer = (await import('nodemailer')) as unknown as {
        createTransport: (opts: Record<string, unknown>) => {
          verify: () => Promise<boolean>
        }
      }
      const transporter = nodemailer.createTransport({
        host: String(ctx.config.smtpHost),
        port: Number(ctx.config.smtpPort ?? 465),
        secure: Number(ctx.config.smtpPort ?? 465) === 465,
        auth: { user: String(ctx.config.username), pass: password },
      })
      await transporter.verify()
    } catch (err) {
      const msg =
        err instanceof Error && /Cannot find module|nodemailer/.test(err.message)
          ? '未安装 nodemailer:请执行 npm i nodemailer'
          : err instanceof Error
            ? err.message
            : String(err)
      this.status = 'error'
      this.detail = msg
      ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
      throw new Error(msg)
    }

    // IMAP 入站:优先 IDLE,失败则轮询;再失败则 SMTP-only 降级
    try {
      await this.startImapInbound(ctx, password)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('warn', 'email', `IMAP inbound failed, SMTP-only: ${msg}`)
      this.inboundMode = 'smtp-only'
      this.detail = `SMTP 已验证;IMAP 入站失败(${msg}),仅可主动发信。`
      this.status = 'connected'
      this.connectedAt = Date.now()
      ctx.bridge.onStatus({
        status: 'connected',
        connectedAt: this.connectedAt,
        detail: this.detail,
        degraded: true,
      })
      return
    }

    this.status = 'connected'
    this.connectedAt = Date.now()
    this.detail =
      this.inboundMode === 'idle' ? 'SMTP + IMAP IDLE 双向已就绪' : 'SMTP + IMAP 轮询收信已就绪'
    ctx.bridge.onStatus({
      status: 'connected',
      connectedAt: this.connectedAt,
      detail: this.detail,
      degraded: this.inboundMode !== 'idle',
    })
    log('info', 'email', `connected mode=${this.inboundMode}`)
  }

  private async startImapInbound(ctx: ChannelRuntimeContext, password: string): Promise<void> {
    let ImapFlowCtor: new (opts: Record<string, unknown>) => ImapFlowLike
    try {
      const mod = (await import('imapflow')) as unknown as {
        ImapFlow: new (opts: Record<string, unknown>) => ImapFlowLike
      }
      ImapFlowCtor = mod.ImapFlow
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      if (/Cannot find module|imapflow/.test(m)) {
        throw new Error('未安装 imapflow:请执行 npm i imapflow')
      }
      throw err instanceof Error ? err : new Error(m)
    }

    const mailbox = String(ctx.config.mailbox ?? 'INBOX').trim() || 'INBOX'
    const pollSeconds = Math.max(15, Number(ctx.config.pollIntervalSec ?? 60) || 60)
    const client = new ImapFlowCtor({
      host: String(ctx.config.imapHost),
      port: Number(ctx.config.imapPort ?? 993),
      secure: Number(ctx.config.imapPort ?? 993) === 993,
      auth: { user: String(ctx.config.username), pass: password },
      logger: false,
    })
    this.imap = client
    client.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      log('warn', 'email', `imap error: ${msg}`)
    })
    await client.connect()
    await client.mailboxOpen(mailbox)

    // 初始:只标记已有 UID,不回放历史邮件,避免启动风暴
    await this.markExistingUids(client)
    const preferIdle = ctx.config.preferIdle !== false

    if (preferIdle) {
      this.inboundMode = 'idle'
      void this.runIdleLoop(ctx, client, mailbox)
    } else {
      this.inboundMode = 'poll'
      this.startPoll(ctx, client, pollSeconds)
    }
  }

  private async markExistingUids(client: ImapFlowLike): Promise<void> {
    try {
      for await (const msg of client.fetch('1:*', { uid: true })) {
        this.seenUids.add(msg.uid)
      }
    } catch {
      // 空邮箱或服务器不支持范围时忽略
    }
  }

  private startPoll(ctx: ChannelRuntimeContext, client: ImapFlowLike, pollSeconds: number): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    const tick = () => {
      void this.fetchNew(ctx, client).catch((err) => {
        log('warn', 'email', `poll fetch failed: ${err instanceof Error ? err.message : err}`)
      })
    }
    tick()
    this.pollTimer = setInterval(tick, pollSeconds * 1000)
  }

  private async runIdleLoop(
    ctx: ChannelRuntimeContext,
    client: ImapFlowLike,
    _mailbox: string,
  ): Promise<void> {
    const pollSeconds = Math.max(15, Number(ctx.config.pollIntervalSec ?? 60) || 60)
    while (!this.idleAbort && this.imap === client) {
      try {
        await this.fetchNew(ctx, client)
        // imapflow idle() 阻塞至有更新或超时;结束后再循环
        await Promise.race([
          client.idle(),
          new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollSeconds, 25) * 1000)),
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log('warn', 'email', `IDLE failed, fallback poll: ${msg}`)
        this.inboundMode = 'poll'
        this.detail = `SMTP 就绪;IMAP IDLE 不可用已降级轮询(${msg})`
        ctx.bridge.onStatus({
          status: 'connected',
          connectedAt: this.connectedAt,
          detail: this.detail,
          degraded: true,
          lastMessageAt: this.lastMessageAt,
        })
        this.startPoll(ctx, client, pollSeconds)
        return
      }
    }
  }

  private async fetchNew(ctx: ChannelRuntimeContext, client: ImapFlowLike): Promise<void> {
    if (!client.usable && this.imap !== client) return
    for await (const msg of client.fetch('1:*', {
      uid: true,
      envelope: true,
      source: true,
    })) {
      if (this.seenUids.has(msg.uid)) continue
      this.seenUids.add(msg.uid)
      // 仅处理未见过的;启动时已标记存量,故此处均为增量
      const from = msg.envelope?.from?.[0]
      const fromAddr = from?.address || 'unknown@mail'
      const subject = msg.envelope?.subject || '(无主题)'
      const raw = msg.source ? msg.source.toString('utf8') : ''
      const body = extractPlainBody(raw)
      const text = `主题: ${subject}\n\n${body}`.trim()
      const inbound: InboundMessage = {
        channel: this.id,
        providerMessageId: msg.envelope?.messageId || `email:uid:${msg.uid}:${Date.now()}`,
        chat: { id: fromAddr, type: 'p2p' },
        sender: { id: fromAddr, name: from?.name },
        text,
        attachments: [],
        receivedAt: Date.now(),
        raw: { uid: msg.uid, subject },
      }
      this.lastMessageAt = Date.now()
      ctx.bridge.onMessage(inbound)
      ctx.bridge.onStatus({
        status: 'connected',
        connectedAt: this.connectedAt,
        lastMessageAt: this.lastMessageAt,
        detail: this.detail,
        degraded: this.inboundMode !== 'idle',
      })
      try {
        await client.messageFlagsAdd(msg.uid, ['\\Seen'])
      } catch {
        // 只读邮箱可忽略
      }
    }
  }

  async disconnect(): Promise<void> {
    this.idleAbort = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    const imap = this.imap
    this.imap = null
    if (imap) {
      try {
        await imap.logout()
      } catch {
        // ignore
      }
    }
    this.ctx = null
    this.status = 'disabled'
    this.detail = undefined
  }

  getStatus() {
    return {
      status: this.status,
      detail: this.detail,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      degraded: this.status === 'connected' && this.inboundMode !== 'idle',
    }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    const subject = `Re: ${extractSubjectFromInbound(msg.text)}`
    return this.push({ chatId: msg.sender.id || msg.chat.id }, content, subject)
  }

  async push(
    target: PushTarget,
    content: OutboundContent,
    subject = '教育顾问通知',
  ): Promise<{ messageId?: string }> {
    const ctx = this.ctx
    if (!ctx) throw new Error('邮件未连接')
    const to = target.chatId || target.senderId
    if (!to?.includes('@')) {
      throw new Error('邮件推送目标须为邮箱地址(chatId)')
    }
    const nodemailer = (await import('nodemailer')) as unknown as {
      createTransport: (opts: Record<string, unknown>) => {
        sendMail: (opts: Record<string, unknown>) => Promise<{ messageId?: string }>
      }
    }
    const password = ((await ctx.getSecret('password')) ?? '').trim()
    const transporter = nodemailer.createTransport({
      host: String(ctx.config.smtpHost),
      port: Number(ctx.config.smtpPort ?? 465),
      secure: Number(ctx.config.smtpPort ?? 465) === 465,
      auth: { user: String(ctx.config.username), pass: password },
    })
    const info = await transporter.sendMail({
      from: String(ctx.config.username),
      to,
      subject,
      text: content.text,
    })
    return { messageId: info.messageId }
  }
}

function extractPlainBody(raw: string): string {
  if (!raw) return ''
  // 极简:剥离常见 header 后取正文;multipart 只取第一段可见文本
  const split = raw.split(/\r?\n\r?\n/)
  if (split.length < 2) return raw.slice(0, 8000)
  let body = split.slice(1).join('\n\n')
  // 去掉 HTML 标签粗略降级
  if (/<html|<body|<div/i.test(body)) {
    body = body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 8000)
}

function extractSubjectFromInbound(text: string): string {
  const m = /^主题:\s*(.+)$/m.exec(text)
  return (m?.[1] || '教育顾问').slice(0, 120)
}

export function createEmailAdapter(): ChannelAdapter {
  return new EmailChannelAdapter()
}

export { EMAIL_MANIFEST_ID, emailManifest }
