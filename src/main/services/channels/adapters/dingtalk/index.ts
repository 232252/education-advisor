// =============================================================
// adapters/dingtalk/index — DingtalkAdapter(ChannelAdapter 的钉钉实现)
// 与 FeishuAdapter 同构的薄适配: 生命周期/收发全部委托
// dingtalkBotService 引擎(connection.ts)。
// 阶段 2 P0(docs/research/2026-09-12-channel-connector-catalog.md §2.1):
// Stream Mode 出站 WSS 桌面直连 + AI 卡片打字机 + downloadCode 文件两跳。
// =============================================================

import type {
  ChannelConfigValidation,
  ChannelFetchedAttachment,
  ChannelRunStatus,
  InboundAttachment,
  InboundMessage,
  OutboundContent,
  PushTarget,
  ReplySession,
} from '@shared/types'
import { settingsService } from '../../../settings-service'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { DingtalkApiClient } from './api'
import { dingtalkBotService } from './connection'
import { DINGTALK_MANIFEST_ID, dingtalkManifest } from './manifest'

export class DingtalkAdapter implements ChannelAdapter {
  readonly id = DINGTALK_MANIFEST_ID
  readonly manifest = dingtalkManifest
  /** connect 时注册的引擎状态监听(disconnect 时摘除,防监听器泄漏) */
  private engineStatusHandler: ((info: { status: string; error?: string; connectedAt?: number }) => void) | null =
    null

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const clientId = String(ctx.config.clientId ?? '').trim()
    if (!clientId) return { ok: false, message: 'Client ID 未填写', field: 'clientId' }
    const clientSecret = ((await ctx.getSecret('clientSecret')) ?? '').trim()
    if (!clientSecret) return { ok: false, message: 'Client Secret 未配置', field: 'clientSecret' }
    // 不建长连接的凭证预检: 换 accessToken,错误映射为可读提示
    const api = new DingtalkApiClient({ clientId, clientSecret })
    const error = await api.validateCredentials()
    if (error) return { ok: false, message: error, field: 'clientSecret' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    const clientId = String(ctx.config.clientId ?? '').trim()
    const clientSecret = ((await ctx.getSecret('clientSecret')) ?? '').trim()
    const channelCfg = settingsService.getSettings().channels?.dingtalk
    if (!this.engineStatusHandler) {
      this.engineStatusHandler = (info) => {
        ctx.bridge.onStatus(this.mapEngineStatus(info))
      }
      dingtalkBotService.on('status', this.engineStatusHandler)
    }
    await dingtalkBotService.start(clientId, clientSecret, ctx.getWin(), {
      cardTemplateId: typeof channelCfg?.cardTemplateId === 'string' ? channelCfg.cardTemplateId : undefined,
      allowGroups: channelCfg?.allowGroups !== false,
      agentId: typeof channelCfg?.agentId === 'string' ? channelCfg.agentId : undefined,
    })
    const st = dingtalkBotService.getStatus()
    if (st.status === 'error') {
      throw new Error(st.error ?? '钉钉连接失败')
    }
  }

  async disconnect(opts?: { userInitiated?: boolean }): Promise<void> {
    if (this.engineStatusHandler) {
      dingtalkBotService.removeListener('status', this.engineStatusHandler)
      this.engineStatusHandler = null
    }
    await dingtalkBotService.stop(opts)
  }

  /** 引擎状态(五态语义) → 渠道状态 */
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
    return this.mapEngineStatus(dingtalkBotService.getStatus())
  }

  getStats(): { processingCount: number; pendingCount: number } {
    const s = dingtalkBotService.getStatus()
    return { processingCount: s.processingCount ?? 0, pendingCount: s.pendingCount ?? 0 }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    // v1: 钉钉回复依赖每条消息的 sessionWebhook(投递信息由引擎流水线持有),
    // 统一 Bridge 收口(v2)时经 InboundMessage 携带;当前引擎内完成回复。
    void msg
    void content
    throw new Error('钉钉回复由引擎流水线内完成(v1 不经适配器入口)')
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    const api = dingtalkBotService.getApi()
    if (!api) throw new Error('钉钉未连接,无法主动推送')
    // target.chatId 语义: 单聊 = userId;群聊 = openConversationId(与解析层 chatId 一致)
    // 无法从 target 区分会话类型 → 以推送场景默认单聊,群推送经 pushGroupMessage 扩展
    await api.pushOtoMessage(target.chatId, content.text)
    return {}
  }

  createReplySession(msg: InboundMessage, placeholderText: string): Promise<ReplySession> {
    throw new Error('钉钉回复会话由引擎流水线内创建(v1 不经适配器入口)')
  }

  async fetchAttachment(
    msg: InboundMessage,
    att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    const api = dingtalkBotService.getApi()
    if (!api) return { ok: false, error: '钉钉未连接,无法下载附件' }
    const r = await api.downloadAttachment({
      downloadCode: att.fileKey,
      fileName: att.fileName,
      kind: att.kind,
      dir: dingtalkBotService.getFilesDir(),
    })
    if (r.ok) return { ok: true, path: r.saved.path, bytes: r.saved.bytes }
    return { ok: false, error: r.error }
  }
}

/** 渠道工厂(ChannelManager 注册用;每渠道单实例) */
export function createDingtalkAdapter(): ChannelAdapter {
  return new DingtalkAdapter()
}
