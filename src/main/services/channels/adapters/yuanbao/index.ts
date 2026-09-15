import { createHmac, randomBytes } from 'node:crypto'
import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import { log } from '../../../../utils/logger'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { jsonFetch } from '../_shared/bot-http'
import { YUANBAO_MANIFEST_ID, yuanbaoManifest } from './manifest'

const SIGN_TOKEN_PATH = '/api/v5/robotLogic/sign-token'

function beijingTimestamp(): string {
  // 官方要求 Asia/Shanghai ISO-8601(含 +08:00)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`
}

function computeSignature(
  nonce: string,
  timestamp: string,
  appKey: string,
  appSecret: string,
): string {
  const payload = `${nonce}${timestamp}${appKey}${appSecret}`
  return createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex')
}

/**
 * 元宝官方路径 = 签名 sign-token HTTP + protobuf WebSocket。
 * 本期:用官方签名算法探活凭证;protobuf 编解码尚未内置 → 诚实失败。
 */
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
    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'
    const appKey = String(ctx.config.appId ?? '').trim()
    const appSecret = ((await ctx.getSecret('appSecret')) ?? '').trim()
    const apiDomain = String(ctx.config.apiDomain ?? 'https://bot.yuanbao.tencent.com').replace(
      /\/$/,
      '',
    )
    const routeEnv = String(ctx.config.routeEnv ?? '').trim()

    let tokenProbe = ''
    let credentialsOk = false
    try {
      const nonce = randomBytes(16).toString('hex')
      const timestamp = beijingTimestamp()
      const signature = computeSignature(nonce, timestamp, appKey, appSecret)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-AppVersion': 'education-advisor/1.0',
        'X-Instance-Id': '17',
        'X-Bot-Version': 'education-advisor/1.0',
      }
      if (routeEnv) headers['X-Route-Env'] = routeEnv
      const res = await jsonFetch(`${apiDomain}${SIGN_TOKEN_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ app_key: appKey, nonce, signature, timestamp }),
        timeoutMs: 12_000,
      })
      const body = res.json as {
        code?: number
        message?: string
        data?: { token?: string; bot_id?: string }
      } | null
      if (res.ok && body?.code === 0 && body.data?.token) {
        credentialsOk = true
        tokenProbe = `凭证有效(sign-token OK, bot_id=${body.data.bot_id ?? '?'})`
      } else {
        tokenProbe = `sign-token 失败 HTTP ${res.status} code=${body?.code ?? '?'} ${(body?.message || res.text).slice(0, 160)}`
      }
    } catch (err) {
      tokenProbe = `sign-token 网络失败: ${err instanceof Error ? err.message : String(err)}`
    }

    this.status = 'error'
    this.detail =
      `${tokenProbe}。` +
      (credentialsOk
        ? '凭证已验证,但长连接仍需官方 protobuf WebSocket 编解码(ConnMsg/InboundMessagePush),本版本尚未内置,故不伪造成功连接。'
        : '请检查 AppID/AppSecret 与网络。') +
      '产品语义:助手出站,非班级群播报。'
    log('info', 'yuanbao', this.detail)
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
    throw new Error('元宝出站尚未就绪:缺少 protobuf WS 编解码')
  }

  async push(_target: PushTarget, _content: OutboundContent): Promise<{ messageId?: string }> {
    throw new Error('元宝主动推送尚未就绪:缺少 protobuf WS 编解码')
  }
}

export function createYuanbaoAdapter(): ChannelAdapter {
  return new YuanbaoChannelAdapter()
}

export { YUANBAO_MANIFEST_ID, yuanbaoManifest }
