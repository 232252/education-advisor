// =============================================================
// adapters/qq/index — QqBotAdapter
// =============================================================

import type {
  ChannelConfigValidation,
  ChannelFetchedAttachment,
  ChannelRunStatus,
  InboundAttachment,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import { settingsService } from '../../../settings-service'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { qqBotService } from './connection'
import { QQ_MANIFEST_ID } from './constants'
import { qqManifest } from './manifest'

export class QqBotAdapter implements ChannelAdapter {
  readonly id = QQ_MANIFEST_ID
  readonly manifest = qqManifest
  private engineStatusHandler:
    | ((info: {
        status: string
        error?: string
        connectedAt?: number
        lastMessageAt?: number
        lastErrorAt?: number
        reconnectAttempt?: number
      }) => void)
    | null = null

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const appId = String(ctx.config.appId ?? '').trim()
    if (!appId) return { ok: false, message: 'AppID 未填写', field: 'appId' }
    const secret = ((await ctx.getSecret('clientSecret')) ?? '').trim()
    if (!secret) return { ok: false, message: 'AppSecret 未配置', field: 'clientSecret' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    const appId = String(ctx.config.appId ?? '').trim()
    const secret = ((await ctx.getSecret('clientSecret')) ?? '').trim()
    const channelCfg = settingsService.getSettings().channels?.qq
    if (!this.engineStatusHandler) {
      this.engineStatusHandler = (info) => {
        ctx.bridge.onStatus(this.mapEngineStatus(info))
      }
      qqBotService.on('status', this.engineStatusHandler)
    }
    await qqBotService.start(appId, secret, ctx.getWin(), {
      allowGroups: channelCfg?.allowGroups !== false,
      agentId: typeof channelCfg?.agentId === 'string' ? channelCfg.agentId : undefined,
    })
    const st = qqBotService.getStatus()
    if (st.status === 'error') throw new Error(st.error ?? 'QQ 连接失败')
  }

  async disconnect(opts?: { userInitiated?: boolean }): Promise<void> {
    if (this.engineStatusHandler) {
      qqBotService.removeListener('status', this.engineStatusHandler)
      this.engineStatusHandler = null
    }
    await qqBotService.stop(opts)
  }

  private mapEngineStatus(s: {
    status: string
    error?: string
    connectedAt?: number
    lastMessageAt?: number
    lastErrorAt?: number
    reconnectAttempt?: number
  }): {
    status: ChannelRunStatus
    detail?: string
    connectedAt?: number
    lastMessageAt?: number
    lastErrorAt?: number
    reconnectAttempt?: number
  } {
    const status: ChannelRunStatus =
      s.status === 'connected'
        ? 'connected'
        : s.status === 'connecting'
          ? 'connecting'
          : s.status === 'error'
            ? 'error'
            : 'disabled'
    return {
      status,
      detail: s.error,
      connectedAt: s.connectedAt,
      lastMessageAt: s.lastMessageAt,
      lastErrorAt: s.lastErrorAt,
      reconnectAttempt: s.reconnectAttempt,
    }
  }

  getStatus() {
    return this.mapEngineStatus(qqBotService.getStatus())
  }

  getStats() {
    const s = qqBotService.getStatus()
    return { processingCount: s.processingCount ?? 0, pendingCount: s.pendingCount ?? 0 }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    await qqBotService.replyOutboundFromMessage(
      msg.providerMessageId,
      content.text,
      content.media ?? [],
    )
    return {}
  }

  async createReplySession(
    msg: InboundMessage,
    _placeholderText: string,
  ): Promise<import('@shared/types').ReplySession> {
    return qqBotService.createReplySessionFromMessage(msg.providerMessageId, [])
  }

  /**
   * 配额感知主动推送:真正调用官方 OpenAPI(文本 + 可选富媒体 /files)。
   * 成功则返回;配额/窗口/媒体错误以可读 Error 抛出(UI 展示,非静默拒绝)。
   */
  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    const api = qqBotService.getApi()
    if (!api) throw new Error('QQ 未连接')
    const isGroup = Boolean(target.chatId && target.senderId && target.chatId !== target.senderId)
    // 约定: group 用 chatId=groupOpenid; c2c 用 chatId=user openid
    if (isGroup || (target as { kind?: string }).kind === 'group') {
      const media = content.media ?? []
      await api.pushOutbound({
        kind: 'group',
        openid: target.senderId || '',
        groupOpenid: target.chatId,
        text: content.text,
        media,
      })
    } else {
      await api.pushOutbound({
        kind: 'c2c',
        openid: target.chatId,
        text: content.text,
        media: content.media ?? [],
      })
    }
    return {}
  }

  async fetchAttachment(
    _msg: InboundMessage,
    att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    if (!/^https?:\/\//i.test(att.fileKey)) {
      return { ok: false, error: '无效的 QQ 附件 URL' }
    }
    try {
      const res = await fetch(att.fileKey)
      if (!res.ok) return { ok: false, error: `下载失败 HTTP ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      const { app } = await import('electron')
      const pathMod = await import('node:path')
      const fs = await import('node:fs')
      let dir = ''
      try {
        dir = pathMod.join(app.getPath('userData'), 'channels/qq/files')
      } catch {
        dir = pathMod.join(process.env.TEMP ?? '.', 'channels/qq/files')
      }
      fs.mkdirSync(dir, { recursive: true })
      const dest = pathMod.join(
        dir,
        `${Date.now()}_${pathMod.basename(att.fileName || 'qq-file.bin')}`,
      )
      fs.writeFileSync(dest, buf)
      return { ok: true, path: dest, bytes: buf.length }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

export function createQqAdapter(): ChannelAdapter {
  return new QqBotAdapter()
}

export { QQ_MANIFEST_ID } from './constants'
export { qqManifest } from './manifest'
