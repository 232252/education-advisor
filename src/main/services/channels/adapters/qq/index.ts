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
    | ((info: { status: string; error?: string; connectedAt?: number }) => void)
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
  }): { status: ChannelRunStatus; detail?: string; connectedAt?: number } {
    const status: ChannelRunStatus =
      s.status === 'connected'
        ? 'connected'
        : s.status === 'connecting'
          ? 'connecting'
          : s.status === 'error'
            ? 'error'
            : 'disabled'
    return { status, detail: s.error, connectedAt: s.connectedAt }
  }

  getStatus() {
    return this.mapEngineStatus(qqBotService.getStatus())
  }

  getStats() {
    const s = qqBotService.getStatus()
    return { processingCount: s.processingCount ?? 0, pendingCount: s.pendingCount ?? 0 }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    void msg
    void content
    throw new Error('QQ 回复由引擎流水线内完成(v1 不经适配器入口)')
  }

  async push(_target: PushTarget, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('QQ 主动推送受配额限制(pushPolicy=quota);v1 不支持主动推送')
  }

  async fetchAttachment(
    _msg: InboundMessage,
    _att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    return { ok: false, error: 'QQ v1 暂不支持附件' }
  }
}

export function createQqAdapter(): ChannelAdapter {
  return new QqBotAdapter()
}

export { qqManifest } from './manifest'
export { QQ_MANIFEST_ID } from './constants'
