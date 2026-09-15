// =============================================================
// adapters/weixin/index — WeixinILinkAdapter(个人微信 iLink)
// =============================================================

import path from 'node:path'
import type {
  ChannelConfigValidation,
  ChannelFetchedAttachment,
  ChannelRunStatus,
  InboundAttachment,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import { app } from 'electron'
import { errText } from '../../../../utils/err-text'
import { settingsService } from '../../../settings-service'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { weixinBotService } from './connection'
import { RECEIVED_FILES_DIR_NAME, WEIXIN_DEFAULT_BASE_URL, WEIXIN_MANIFEST_ID } from './constants'
import { weixinManifest } from './manifest'
import { downloadILinkMedia } from './media'
import { decodeWeixinMediaKey } from './parsing'

export class WeixinILinkAdapter implements ChannelAdapter {
  readonly id = WEIXIN_MANIFEST_ID
  readonly manifest = weixinManifest
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
    const token = ((await ctx.getSecret('botToken')) ?? '').trim()
    if (!token) return { ok: false, message: '尚未扫码绑定(Bot Token 为空)', field: 'botToken' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    const token = ((await ctx.getSecret('botToken')) ?? '').trim()
    const baseUrl = String(ctx.config.baseUrl ?? WEIXIN_DEFAULT_BASE_URL).trim()
    const channelCfg = settingsService.getSettings().channels?.weixin
    if (!this.engineStatusHandler) {
      this.engineStatusHandler = (info) => {
        ctx.bridge.onStatus(this.mapEngineStatus(info))
      }
      weixinBotService.on('status', this.engineStatusHandler)
    }
    await weixinBotService.start(token, ctx.getWin(), {
      baseUrl,
      agentId: typeof channelCfg?.agentId === 'string' ? channelCfg.agentId : undefined,
    })
    const st = weixinBotService.getStatus()
    if (st.status === 'error') {
      throw new Error(st.error ?? '微信连接失败')
    }
  }

  async disconnect(opts?: { userInitiated?: boolean }): Promise<void> {
    if (this.engineStatusHandler) {
      weixinBotService.removeListener('status', this.engineStatusHandler)
      this.engineStatusHandler = null
    }
    await weixinBotService.stop(opts)
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
    return this.mapEngineStatus(weixinBotService.getStatus())
  }

  getStats(): { processingCount: number; pendingCount: number } {
    const s = weixinBotService.getStatus()
    return { processingCount: s.processingCount ?? 0, pendingCount: s.pendingCount ?? 0 }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    const client = weixinBotService.getClient()
    if (!client) throw new Error('微信未连接')
    const token =
      weixinBotService.getContextToken(msg.chat.id) ||
      weixinBotService.getContextToken(msg.sender.id)
    if (!token) throw new Error('缺少 context_token')
    await client.sendText(msg.chat.id, content.text, token)
    return {}
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    await weixinBotService.pushText(target.chatId, content.text)
    return {}
  }

  async fetchAttachment(
    _msg: InboundMessage,
    att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    const client = weixinBotService.getClient()
    if (!client) return { ok: false, error: '微信未连接' }
    const meta = decodeWeixinMediaKey(att.fileKey)
    if (!meta) return { ok: false, error: '无效的微信媒体引用' }
    let filesDir = ''
    try {
      filesDir = path.join(app.getPath('userData'), RECEIVED_FILES_DIR_NAME)
    } catch {
      filesDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', RECEIVED_FILES_DIR_NAME)
    }
    const dest = path.join(filesDir, `${Date.now()}_${path.basename(meta.fileName)}`)
    try {
      const { bytes } = await downloadILinkMedia(client, {
        encryptQueryParam: meta.encryptQueryParam,
        aesKey: meta.aesKey,
        destPath: dest,
      })
      return { ok: true, path: dest, bytes }
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  }
}

export function createWeixinAdapter(): ChannelAdapter {
  return new WeixinILinkAdapter()
}

export { WEIXIN_MANIFEST_ID } from './constants'
export { weixinManifest } from './manifest'
