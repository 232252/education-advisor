// =============================================================
// adapters/email — 邮件薄客户端骨架(nodemailer SMTP 探活 + 配置校验)
// IMAP IDLE 收信在后续迭代接入;本期可配置、可测试 SMTP、可 push 发信。
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

export class EmailChannelAdapter implements ChannelAdapter {
  readonly id = EMAIL_MANIFEST_ID
  readonly manifest = emailManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  private ctx: ChannelRuntimeContext | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

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
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'
    // SMTP 探活(动态导入 nodemailer;缺失时给出可读错误)
    try {
      const nodemailer = (await import('nodemailer')) as unknown as {
        createTransport: (opts: Record<string, unknown>) => {
          verify: () => Promise<boolean>
        }
      }
      const password = ((await ctx.getSecret('password')) ?? '').trim()
      const transporter = nodemailer.createTransport({
        host: String(ctx.config.smtpHost),
        port: Number(ctx.config.smtpPort ?? 465),
        secure: Number(ctx.config.smtpPort ?? 465) === 465,
        auth: {
          user: String(ctx.config.username),
          pass: password,
        },
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
    this.status = 'connected'
    this.connectedAt = Date.now()
    this.detail =
      'SMTP 已验证。IMAP IDLE 收信将在后续版本启用;当前可用主动推送(发信)。'
    ctx.bridge.onStatus({
      status: 'connected',
      connectedAt: this.connectedAt,
      detail: this.detail,
      degraded: true,
    })
    log('info', 'email', 'SMTP verified; IMAP idle pending')
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.ctx = null
    this.status = 'disabled'
  }

  getStatus() {
    return {
      status: this.status,
      detail: this.detail,
      connectedAt: this.connectedAt,
      degraded: this.status === 'connected',
    }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    return this.push({ chatId: msg.sender.id || msg.chat.id }, content)
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    const ctx = this.ctx
    if (!ctx) throw new Error('邮件未连接')
    const to = target.chatId || target.senderId
    if (!to || !to.includes('@')) {
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
      subject: '教育顾问通知',
      text: content.text,
    })
    return { messageId: info.messageId }
  }
}

export function createEmailAdapter(): ChannelAdapter {
  return new EmailChannelAdapter()
}

export { emailManifest, EMAIL_MANIFEST_ID }
