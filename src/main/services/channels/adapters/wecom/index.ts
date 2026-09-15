// =============================================================
// adapters/wecom/index — WecomAibotAdapter(ChannelAdapter 的企微实现)
// 阶段 3 P1(docs/research/2026-09-12-channel-connector-catalog.md §2.2)。
// 与 DingtalkAdapter 同构的薄适配: 生命周期/收发全部委托
// wecomBotService 引擎(connection.ts)。
// validateConfig = 轻量 WS 认证探针(建连→订阅→收 errcode→断开,
// 企微无 HTTP 凭证校验端点)。
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
import { wecomBotService } from './connection'
import { WECOM_MANIFEST_ID, wecomManifest } from './manifest'
import { WecomWsClient } from './ws-client'

export class WecomAibotAdapter implements ChannelAdapter {
  readonly id = WECOM_MANIFEST_ID
  readonly manifest = wecomManifest
  /** connect 时注册的引擎状态监听(disconnect 时摘除,防监听器泄漏) */
  private engineStatusHandler:
    | ((info: { status: string; error?: string; connectedAt?: number }) => void)
    | null = null

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const botId = String(ctx.config.botId ?? '').trim()
    if (!botId) return { ok: false, message: 'Bot ID 未填写', field: 'botId' }
    const secret = ((await ctx.getSecret('secret')) ?? '').trim()
    if (!secret) return { ok: false, message: '长连接 Secret 未配置', field: 'secret' }
    // 认证探针: 短连接,订阅成功即断(企微无 HTTP 凭证校验端点)
    const probe = new WecomWsClient({ botId, secret, onMessage: () => {} })
    try {
      await probe.connect()
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        field: 'secret',
      }
    } finally {
      probe.stop()
    }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    const botId = String(ctx.config.botId ?? '').trim()
    const secret = ((await ctx.getSecret('secret')) ?? '').trim()
    const channelCfg = settingsService.getSettings().channels?.wecom
    if (!this.engineStatusHandler) {
      this.engineStatusHandler = (info) => {
        ctx.bridge.onStatus(this.mapEngineStatus(info))
      }
      wecomBotService.on('status', this.engineStatusHandler)
    }
    await wecomBotService.start(botId, secret, ctx.getWin(), {
      allowGroups: channelCfg?.allowGroups !== false,
      agentId: typeof channelCfg?.agentId === 'string' ? channelCfg.agentId : undefined,
    })
    const st = wecomBotService.getStatus()
    if (st.status === 'error') {
      throw new Error(st.error ?? '企微连接失败')
    }
  }

  async disconnect(opts?: { userInitiated?: boolean }): Promise<void> {
    if (this.engineStatusHandler) {
      wecomBotService.removeListener('status', this.engineStatusHandler)
      this.engineStatusHandler = null
    }
    await wecomBotService.stop(opts)
  }

  /** 引擎状态 → 渠道状态 */
  private mapEngineStatus(s: { status: string; error?: string; connectedAt?: number }): {
    status: ChannelRunStatus
    detail?: string
    connectedAt?: number
  } {
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
    return this.mapEngineStatus(wecomBotService.getStatus())
  }

  getStats(): { processingCount: number; pendingCount: number } {
    const s = wecomBotService.getStatus()
    return { processingCount: s.processingCount ?? 0, pendingCount: s.pendingCount ?? 0 }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    // v1: 企微回复依赖每条回调的 req_id(投递信息由引擎流水线持有),
    // 统一 Bridge 收口(v2)时经 InboundMessage 携带;当前引擎内完成回复。
    void msg
    void content
    throw new Error('企微回复由引擎流水线内完成(v1 不经适配器入口)')
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    // aibot_send_msg: 前置条件「用户先发过消息」由平台侧校验(capabilities.pushPolicy)
    wecomBotService.sendProactive(target.chatId, content.text)
    return {}
  }

  async fetchAttachment(
    msg: InboundMessage,
    att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    // 企微附件在收帧时即预取落盘(url 5 分钟时效),不走懒下载入口
    void msg
    void att
    return { ok: false, error: '企微附件在接收时已即时下载(不支持懒取)' }
  }
}

/** 渠道工厂(ChannelManager 注册用;每渠道单实例) */
export function createWecomAdapter(): ChannelAdapter {
  return new WecomAibotAdapter()
}
