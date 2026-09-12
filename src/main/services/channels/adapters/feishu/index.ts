// =============================================================
// adapters/feishu/index — FeishuAdapter(ChannelAdapter 的飞书实现)
// 连接生命周期/守护重启复用 connection.ts 的单例引擎;
// 本文件把它适配到统一频道接口(阶段 1 §3.3):
//   validateConfig = 格式预检 + 显式鉴权(测试连接)
//   connect        = service.start(凭证从 ctx.getSecret 读,不落盘)
//   sendReply/push/createReplySession/fetchAttachment = 平台收发
// 渠道绑定 Agent(channels.feishu.agentId,M4)经 bridge 流水线传递。
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
import type { FeishuDomain } from '../../../feishu-service'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { feishuBotService } from './connection'
import { APP_ID_PATTERN } from './constants'
import { validateCredentials } from './credentials'
import { saveAttachment } from './file-receive'
import { setFeishuBase } from './http-instance'
import { FEISHU_MANIFEST_ID, feishuManifest } from './manifest'
import { sendReply } from './reply'
import { createReplySession } from './reply-session'
import type { BotStatusInfo } from './types'

function domainFromConfig(config: Record<string, unknown>): FeishuDomain {
  return config.domain === 'lark' ? 'lark' : 'feishu'
}

export class FeishuAdapter implements ChannelAdapter {
  readonly id = FEISHU_MANIFEST_ID
  readonly manifest = feishuManifest
  /** connect 时注册的引擎状态监听(disconnect 时摘除,防监听器泄漏) */
  private engineStatusHandler: ((info: BotStatusInfo) => void) | null = null

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const appId = String(ctx.config.appId ?? '').trim()
    if (!appId) return { ok: false, message: 'App ID 未填写', field: 'appId' }
    if (!APP_ID_PATTERN.test(appId)) {
      return { ok: false, message: 'App ID 格式不正确(应为 cli_ 开头的应用 ID)', field: 'appId' }
    }
    const appSecret = ((await ctx.getSecret('appSecret')) ?? '').trim()
    if (!appSecret) return { ok: false, message: 'App Secret 未配置', field: 'appSecret' }
    setFeishuBase(domainFromConfig(ctx.config))
    const error = await validateCredentials(appId, appSecret)
    if (error) return { ok: false, message: error, field: 'appSecret' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    const appId = String(ctx.config.appId ?? '').trim()
    const appSecret = ((await ctx.getSecret('appSecret')) ?? '').trim()
    const domain = domainFromConfig(ctx.config)
    // 引擎状态 → Manager 聚合(连接/断开/错误/降级可见)
    if (!this.engineStatusHandler) {
      this.engineStatusHandler = (info) => {
        ctx.bridge.onStatus(this.mapEngineStatus(info))
      }
      feishuBotService.on('status', this.engineStatusHandler)
    }
    // start 对格式/凭证错误不抛错而是置 error 状态 — 转成异常交给 Manager 记 error
    await feishuBotService.start(appId, appSecret, ctx.getWin(), domain)
    const st = feishuBotService.getStatus()
    if (st.status === 'error') {
      throw new Error(st.error ?? '飞书连接失败')
    }
  }

  async disconnect(opts?: { userInitiated?: boolean }): Promise<void> {
    if (this.engineStatusHandler) {
      feishuBotService.removeListener('status', this.engineStatusHandler)
      this.engineStatusHandler = null
    }
    await feishuBotService.stop(opts)
  }

  /** 引擎状态(五态语义) → 渠道状态 */
  private mapEngineStatus(s: BotStatusInfo): {
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
    return this.mapEngineStatus(feishuBotService.getStatus())
  }

  getStats(): { processingCount: number; pendingCount: number } {
    const s = feishuBotService.getStatus()
    return { processingCount: s.processingCount ?? 0, pendingCount: s.pendingCount ?? 0 }
  }

  async sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    await sendReply(feishuBotService.getSdkClient(), msg.providerMessageId, content.text)
    return {}
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    const client = feishuBotService.getSdkClient()
    if (!client) throw new Error('飞书未连接,无法主动推送')
    const res = (await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: target.chatId,
        content: JSON.stringify({ text: content.text }),
        msg_type: 'text',
      },
    })) as { code?: number; msg?: string; data?: { message_id?: string } }
    if (typeof res.code === 'number' && res.code !== 0) {
      throw new Error(`飞书推送失败(code=${res.code}): ${res.msg ?? ''}`)
    }
    return { messageId: res.data?.message_id }
  }

  createReplySession(msg: InboundMessage, placeholderText: string): Promise<ReplySession> {
    return createReplySession(
      {
        getSdkClient: () => feishuBotService.getSdkClient(),
        getAccessToken: () => feishuBotService.getAccessToken(),
      },
      msg.providerMessageId,
      placeholderText,
    )
  }

  async fetchAttachment(
    msg: InboundMessage,
    att: InboundAttachment,
  ): Promise<ChannelFetchedAttachment> {
    const r = await saveAttachment({
      getAccessToken: () => feishuBotService.getAccessToken(),
      messageId: msg.providerMessageId,
      fileKey: att.fileKey,
      kind: att.kind,
      fileName: att.fileName,
      dir: feishuBotService.getFilesDir(),
    })
    if (r.ok) return { ok: true, path: r.saved.path, bytes: r.saved.bytes }
    return { ok: false, error: r.error }
  }
}

/** 渠道工厂(ChannelManager 注册用;每渠道单实例,工厂每次返回同一包装) */
export function createFeishuAdapter(): ChannelAdapter {
  return new FeishuAdapter()
}
