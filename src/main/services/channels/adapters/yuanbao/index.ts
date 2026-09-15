// =============================================================
// adapters/yuanbao — 腾讯元宝 Bot (sign-token + protobuf WS)
// Protocol port from QwenPaw yuanbao/ (Apache-2.0 study → TS rewrite)
// =============================================================

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type {
  ChannelConfigValidation,
  ChannelFetchedAttachment,
  ChannelRunStatus,
  InboundAttachment,
  InboundMessage,
  OutboundContent,
  OutboundMediaRef,
  PushTarget,
} from '@shared/types'
import { log } from '../../../../utils/logger'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { checkAcl, policyFromConfig, type AclPolicy } from '../_shared/acl'
import { HealthTracker } from '../_shared/health'
import { YuanbaoTokenManager } from './auth'
import {
  buildSendC2cMsg,
  buildSendGroupMsg,
  extractAttachmentsFromMsgBody,
  extractTextFromMsgBody,
  initYuanbaoProto,
  type InboundYuanbaoMessage,
} from './codec'
import {
  DEFAULT_API_DOMAIN,
  DEFAULT_WS_URL,
  TEXT_CHUNK_LIMIT,
} from './constants'
import { YUANBAO_MANIFEST_ID, yuanbaoManifest } from './manifest'
import {
  buildFileMsgBody,
  buildImageMsgBody,
  downloadAndUploadMedia,
  resolveDownloadUrl,
  type FetchLike,
} from './media'
import { YuanbaoWsClient } from './ws-client'

function outboundText(content: OutboundContent): string {
  return content.kind === 'text' || content.kind === 'markdown' ? content.text : ''
}

function chunkText(text: string, limit = TEXT_CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit))
  return chunks
}

export class YuanbaoChannelAdapter implements ChannelAdapter {
  readonly id = YUANBAO_MANIFEST_ID
  readonly manifest = yuanbaoManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private ctx: ChannelRuntimeContext | null = null
  private tokenManager: YuanbaoTokenManager | null = null
  private client: YuanbaoWsClient | null = null
  private acl: AclPolicy = { dm: 'open', group: 'open', allowFrom: [] }
  private health = new HealthTracker()
  private botId = ''
  private apiDomain = DEFAULT_API_DOMAIN
  private fetchImpl: FetchLike = (url, init) => fetch(url, init)
  private mediaDir: string

  constructor() {
    this.mediaDir = join(tmpdir(), 'ea-yuanbao-media')
  }

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    if (!String(ctx.config.appId ?? '').trim()) {
      return { ok: false, message: 'AppID 未填写', field: 'appId' }
    }
    if (!((await ctx.getSecret('appSecret')) ?? '').trim()) {
      return { ok: false, message: 'AppSecret 未配置', field: 'appSecret' }
    }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.ctx = ctx
    this.acl = policyFromConfig(ctx.config)
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'
    this.health.status = 'connecting'

    const appKey = String(ctx.config.appId ?? '').trim()
    const appSecret = ((await ctx.getSecret('appSecret')) ?? '').trim()
    const apiDomain = String(ctx.config.apiDomain ?? DEFAULT_API_DOMAIN).replace(/\/$/, '')
    const routeEnv = String(ctx.config.routeEnv ?? '').trim() || undefined
    const wsUrl = String(ctx.config.wsUrl ?? DEFAULT_WS_URL).trim() || DEFAULT_WS_URL
    this.apiDomain = apiDomain || DEFAULT_API_DOMAIN
    if (typeof ctx.config.mediaDir === 'string' && ctx.config.mediaDir.trim()) {
      this.mediaDir = ctx.config.mediaDir.trim()
    }

    initYuanbaoProto()
    this.tokenManager = new YuanbaoTokenManager(appKey, appSecret, apiDomain)
    this.client = new YuanbaoWsClient({
      tokenManager: this.tokenManager,
      wsUrl,
      routeEnv,
      onInbound: (msg) => this.handleInbound(msg),
      onStatus: (s, detail) => {
        this.status = s
        this.detail = detail
        if (s === 'connected') {
          this.health.markConnected(detail)
          this.botId = this.client?.currentBotId ?? this.botId
        } else if (s === 'error') {
          this.health.setError(detail ?? 'error')
        }
        ctx.bridge.onStatus({
          status: s,
          detail,
          connectedAt: this.health.connectedAt,
          lastErrorAt: this.health.lastErrorAt,
          reconnectAttempt: this.health.reconnectAttempt,
        })
      },
      log: (level, msg) => log(level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info', 'yuanbao', msg),
    })

    try {
      await this.client.connect()
      this.botId = this.client.currentBotId
      this.status = 'connected'
      this.detail = `protobuf WS OK, bot_id=${this.botId}`
      this.health.markConnected(this.detail)
      ctx.bridge.onStatus({
        status: 'connected',
        connectedAt: this.health.connectedAt,
        detail: this.detail,
      })
      log('info', 'yuanbao', this.detail)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.status = 'error'
      this.detail = msg
      this.health.setError(msg)
      this.client?.stop()
      this.tokenManager?.close()
      ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
      throw err
    }
  }

  private handleInbound(native: InboundYuanbaoMessage): void {
    if (!this.ctx) return
    const text = extractTextFromMsgBody(native.msg_body)
    const media = extractAttachmentsFromMsgBody(native.msg_body)
    if (!text && media.length === 0) {
      this.health.inc('inbound_empty')
      return
    }
    const isGroup = Boolean(native.group_code) || native.claw_msg_type === 1
    const chatId = isGroup ? native.group_code : native.from_account
    const senderId = native.from_account
    const acl = checkAcl(this.acl, {
      chatType: isGroup ? 'group' : 'p2p',
      senderId,
      chatId,
    })
    if (acl.decision !== 'allow') {
      this.health.inc(`acl_${acl.decision}`)
      log('info', 'yuanbao', `ACL ${acl.decision}: ${acl.reason} sender=${senderId}`)
      return
    }

    // fileKey holds CDN URL (QQ/wecom pattern); fetchAttachment resolves + downloads
    const attachments: InboundAttachment[] = media.map((m) => ({
      kind: m.type,
      fileKey: m.url,
      fileName: m.name,
    }))

    const inbound: InboundMessage = {
      channel: this.id,
      providerMessageId: native.msg_id || native.msg_key || `${native.msg_seq}:${native.msg_time}`,
      chat: { id: chatId || senderId, type: isGroup ? 'group' : 'p2p' },
      sender: { id: senderId, name: native.sender_nickname || undefined },
      text: text || (media.length ? `[${media.map((m) => m.type).join(',')}]` : ''),
      attachments,
      receivedAt: Date.now(),
      raw: native,
    }
    this.health.lastMessageAt = Date.now()
    this.health.inc('inbound')
    if (media.length) this.health.inc('inbound_media')
    this.ctx.bridge.onMessage(inbound)
    this.ctx.bridge.onStatus({
      status: 'connected',
      connectedAt: this.health.connectedAt,
      lastMessageAt: this.health.lastMessageAt,
      detail: this.detail,
    })
  }

  async disconnect(): Promise<void> {
    this.client?.stop()
    this.client = null
    this.tokenManager?.close()
    this.tokenManager = null
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

  getStats() {
    return {
      processingCount: 0,
      pendingCount: 0,
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

  private sendMsgBody(
    toAccount: string,
    msgBody: Array<{ msg_type: string; msg_content: Record<string, unknown> }>,
    groupCode?: string,
  ): { messageId?: string } {
    if (!this.client?.isConnected) throw new Error('元宝未连接')
    const built = groupCode
      ? buildSendGroupMsg({ groupCode, msgBody, fromAccount: this.botId })
      : buildSendC2cMsg({ toAccount, msgBody, fromAccount: this.botId })
    if (!built) throw new Error('元宝消息编码失败')
    if (!this.client.sendRaw(built.raw)) throw new Error('元宝发送失败: WS 未就绪')
    this.health.inc('outbound')
    return { messageId: built.msgId }
  }

  private sendText(toAccount: string, text: string, groupCode?: string): { messageId?: string } {
    let lastId: string | undefined
    for (const chunk of chunkText(text)) {
      const body = [{ msg_type: 'TIMTextElem', msg_content: { text: chunk } }]
      const r = this.sendMsgBody(toAccount, body, groupCode)
      lastId = r.messageId
    }
    return { messageId: lastId }
  }

  private async sendMediaRef(
    toAccount: string,
    ref: OutboundMediaRef,
    groupCode?: string,
  ): Promise<{ messageId?: string }> {
    if (!this.tokenManager) throw new Error('元宝未连接')
    const authHeaders = await this.tokenManager.getAuthHeaders()
    try {
      const result = await downloadAndUploadMedia(
        ref.source,
        this.fetchImpl,
        this.apiDomain,
        authHeaders,
      )
      const asImage = ref.kind === 'image' || result.mimeType.startsWith('image/')
      const msgBody = asImage ? buildImageMsgBody(result) : buildFileMsgBody(result)
      const r = this.sendMsgBody(toAccount, msgBody, groupCode)
      this.health.inc('outbound_media')
      log('info', 'yuanbao', `sent media ${result.filename} → ${result.url.slice(0, 60)}`)
      return r
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'yuanbao', `media upload/send failed: ${msg}`)
      this.health.inc('outbound_media_fail')
      if (ref.source.startsWith('http://') || ref.source.startsWith('https://')) {
        return this.sendText(toAccount, ref.source, groupCode)
      }
      throw err
    }
  }

  private async sendOutbound(
    toAccount: string,
    content: OutboundContent,
    groupCode?: string,
  ): Promise<{ messageId?: string }> {
    let lastId: string | undefined
    const text = outboundText(content)
    if (text.trim()) {
      lastId = this.sendText(toAccount, text, groupCode).messageId
    }
    for (const ref of content.media ?? []) {
      lastId = (await this.sendMediaRef(toAccount, ref, groupCode)).messageId ?? lastId
    }
    return { messageId: lastId }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    const groupCode = msg.chat.type === 'group' ? msg.chat.id : undefined
    const toAccount = msg.chat.type === 'group' ? msg.sender.id : msg.chat.id
    return this.sendOutbound(toAccount, content, groupCode)
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    const asGroup = Boolean(target.senderId)
    const toAccount = asGroup ? (target.senderId ?? target.chatId) : target.chatId
    const groupCode = asGroup ? target.chatId : undefined
    return this.sendOutbound(toAccount, content, groupCode)
  }

  /** Resolve CDN/resourceId URL and download to mediaDir (QQ-style fileKey=URL). */
  async fetchAttachment(
    _msg: InboundMessage,
    att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    try {
      let url = att.fileKey
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, error: '元宝附件 fileKey 不是 http(s) URL' }
      }
      if (this.tokenManager) {
        const headers = await this.tokenManager.getAuthHeaders()
        url = await resolveDownloadUrl(url, this.fetchImpl, this.apiDomain, headers)
      }
      const res = await this.fetchImpl(url)
      if (!res.ok) return { ok: false, error: `下载失败 HTTP ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(this.mediaDir, { recursive: true })
      const name = att.fileName || `yb-${randomBytes(8).toString('hex')}`
      const path = join(this.mediaDir, name)
      await writeFile(path, buf)
      this.health.inc('fetch_attachment')
      return { ok: true, path, bytes: buf.byteLength }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { ok: false, error }
    }
  }
}

export function createYuanbaoAdapter(): ChannelAdapter {
  return new YuanbaoChannelAdapter()
}

export { yuanbaoManifest, YUANBAO_MANIFEST_ID }
export {
  initYuanbaoProto,
  buildAuthBindMsg,
  buildPingMsg,
  decodeConnMsg,
  encodeConnMsg,
  buildSendC2cMsg,
  extractTextFromMsgBody,
  extractAttachmentsFromMsgBody,
  resetCodecForTests,
} from './codec'
export { computeSignature, beijingTimestamp, generateNonce, YuanbaoTokenManager } from './auth'
export {
  downloadAndUploadMedia,
  buildImageMsgBody,
  buildFileMsgBody,
  signCosRequest,
  parseImageSize,
  guessMime,
} from './media'
