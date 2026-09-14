import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { XIAOYI_MANIFEST_ID, xiaoyiManifest } from './manifest'

export class XiaoyiChannelAdapter implements ChannelAdapter {
  readonly id = XIAOYI_MANIFEST_ID
  readonly manifest = xiaoyiManifest
  private status: ChannelRunStatus = 'disabled'
  private detail?: string

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    if (!String(ctx.config.accessKey ?? '').trim()) {
      return { ok: false, message: 'Access Key 未填写', field: 'accessKey' }
    }
    if (!((await ctx.getSecret('secretKey')) ?? '').trim()) {
      return { ok: false, message: 'Secret Key 未配置', field: 'secretKey' }
    }
    if (!String(ctx.config.agentId ?? '').trim()) {
      return { ok: false, message: 'Agent ID 未填写', field: 'agentId' }
    }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    this.status = 'error'
    this.detail =
      '小艺 A2A WebSocket 适配进行中:凭证可保存校验,长连接尚未打通。助手出站语义,非班级群通道。'
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
    throw new Error('小艺出站尚未就绪')
  }

  async push(_target: PushTarget, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('小艺主动推送尚未就绪')
  }
}

export function createXiaoyiAdapter(): ChannelAdapter {
  return new XiaoyiChannelAdapter()
}

export { xiaoyiManifest, XIAOYI_MANIFEST_ID }
