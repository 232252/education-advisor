import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { YUANBAO_MANIFEST_ID, yuanbaoManifest } from './manifest'

export class YuanbaoChannelAdapter implements ChannelAdapter {
  readonly id = YUANBAO_MANIFEST_ID
  readonly manifest = yuanbaoManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string

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
    this.status = 'error'
    this.detail =
      '元宝 protobuf WebSocket 协议适配进行中:凭证已校验可保存,长连接尚未打通。请关注后续版本。'
    ctx.bridge.onStatus({ status: 'error', detail: this.detail, lastErrorAt: Date.now() })
    throw new Error(this.detail)
  }

  async disconnect(): Promise<void> {
    this.status = 'disabled'
  }

  getStatus() {
    return { status: this.status, detail: this.detail }
  }

  async sendReply(_msg: InboundMessage, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('元宝出站尚未就绪')
  }

  async push(_target: PushTarget, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('元宝主动推送尚未就绪')
  }
}

export function createYuanbaoAdapter(): ChannelAdapter {
  return new YuanbaoChannelAdapter()
}

export { yuanbaoManifest, YUANBAO_MANIFEST_ID }
