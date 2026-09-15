// =============================================================
// adapters/yuanbao — 腾讯元宝 Bot (sign-token + protobuf WS)
// Protocol port from QwenPaw yuanbao/ (Apache-2.0 study → TS rewrite)
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
import { checkAcl, policyFromConfig, type AclPolicy } from '../_shared/acl'
import { HealthTracker } from '../_shared/health'
import { YuanbaoTokenManager } from './auth'
import {
  buildSendC2cMsg,
  buildSendGroupMsg,
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
    if (!text) {
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

    const inbound: InboundMessage = {
      channel: this.id,
      providerMessageId: native.msg_id || native.msg_key || `${native.msg_seq}:${native.msg_time}`,
      chat: { id: chatId || senderId, type: isGroup ? 'group' : 'p2p' },
      sender: { id: senderId, name: native.sender_nickname || undefined },
      text,
      attachments: [],
      receivedAt: Date.now(),
      raw: native,
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

  private sendText(toAccount: string, text: string, groupCode?: string): { messageId?: string } {
    if (!this.client?.isConnected) throw new Error('元宝未连接')
    let lastId: string | undefined
    for (const chunk of chunkText(text)) {
      const body = [{ msg_type: 'TIMTextElem', msg_content: { text: chunk } }]
      const built = groupCode
        ? buildSendGroupMsg({ groupCode, msgBody: body, fromAccount: this.botId })
        : buildSendC2cMsg({ toAccount, msgBody: body, fromAccount: this.botId })
      if (!built) throw new Error('元宝消息编码失败')
      if (!this.client.sendRaw(built.raw)) throw new Error('元宝发送失败: WS 未就绪')
      lastId = built.msgId
      this.health.inc('outbound')
    }
    return { messageId: lastId }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    const text = outboundText(content)
    if (!text.trim()) return {}
    const groupCode = msg.chat.type === 'group' ? msg.chat.id : undefined
    const toAccount = msg.chat.type === 'group' ? msg.sender.id : msg.chat.id
    return this.sendText(toAccount, text, groupCode)
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    const text = outboundText(content)
    if (!text.trim()) return {}
    // Heuristic: chatId that looks like group uses group send
    const asGroup = Boolean(target.senderId)
    if (asGroup) {
      return this.sendText(target.senderId ?? target.chatId, text, target.chatId)
    }
    return this.sendText(target.chatId, text)
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
  resetCodecForTests,
} from './codec'
export { computeSignature, beijingTimestamp, generateNonce, YuanbaoTokenManager } from './auth'
