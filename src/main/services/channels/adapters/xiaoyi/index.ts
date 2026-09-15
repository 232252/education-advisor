import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { XIAOYI_MANIFEST_ID, xiaoyiManifest } from './manifest'

/**
 * 华为小艺云 A2A:平台作为 client 调用开发者 Agent 的 HTTP(JSON-RPC/SSE)端点。
 * 与「桌面端主动连 IM」模型相反 — EA 需作为 A2A agent-server 暴露公网/可达 URL。
 * 本期:凭证校验 + 诚实说明,不伪造长连接成功。
 */
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
    ctx.bridge.onStatus({ status: 'connecting' })
    const endpointHint = String(ctx.config.publicEndpoint ?? '').trim()
    this.status = 'error'
    this.detail =
      '小艺云 A2A 是「平台调用你的 Agent HTTP 端点」(JSON-RPC + SSE),不是桌面端主动连 IM。' +
      (endpointHint ? `已记录公网端点提示: ${endpointHint}。` : '尚未填写 publicEndpoint。') +
      '本版未内置可对外服务的 A2A agent-server / 公网隧道,故不能伪造成功连接。' +
      '产品语义:将本机 Agent 挂到小艺,非班级 IM 群播报。'
    ctx.bridge.onStatus({ status: 'error', detail: this.detail, lastErrorAt: Date.now() })
    throw new Error(this.detail)
  }

  async disconnect(): Promise<void> {
    this.status = 'disabled'
    this.detail = undefined
  }

  getStatus() {
    return { status: this.status, detail: this.detail }
  }

  async sendReply(
    _msg: InboundMessage,
    _content: OutboundContent,
  ): Promise<{ messageId?: string }> {
    throw new Error('小艺出站尚未就绪:需 A2A agent-server')
  }

  async push(_target: PushTarget, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('小艺主动推送尚未就绪:需 A2A agent-server')
  }
}

export function createXiaoyiAdapter(): ChannelAdapter {
  return new XiaoyiChannelAdapter()
}

export { XIAOYI_MANIFEST_ID, xiaoyiManifest }
