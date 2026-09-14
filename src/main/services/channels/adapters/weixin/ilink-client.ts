// =============================================================
// adapters/weixin/ilink-client — 自研 iLink HTTP 薄客户端
// 端点: get_bot_qrcode / get_qrcode_status / getupdates / sendmessage
// 可注入 fetch 便于 vitest 干跑;不依赖 OpenClaw / 第三方 SDK
// =============================================================

import { randomUUID } from 'node:crypto'
import {
  WEIXIN_BOT_TYPE,
  WEIXIN_CHANNEL_VERSION,
  WEIXIN_DEFAULT_BASE_URL,
  WEIXIN_DEFAULT_TIMEOUT_MS,
  WEIXIN_GETUPDATES_TIMEOUT_MS,
  WEIXIN_ITEM_TYPE_TEXT,
  WEIXIN_MSG_STATE_FINISH,
  WEIXIN_MSG_TYPE_BOT,
  WEIXIN_QR_STATUS_TIMEOUT_MS,
} from './constants'
import { makeILinkHeaders } from './headers'

export type FetchLike = typeof fetch

export interface ILinkClientOptions {
  botToken?: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

export interface BotQrcodeResult {
  qrcode: string
  /** 部分实现返回 base64 PNG;本产品优先用 scanUrl 本地渲染 */
  qrcodeImgContent?: string
  scanUrl: string
}

export interface QrcodeStatusResult {
  status: string
  botToken?: string
  baseUrl?: string
  raw: Record<string, unknown>
}

export class ILinkClient {
  botToken: string
  baseUrl: string
  private fetchImpl: FetchLike

  constructor(opts: ILinkClientOptions = {}) {
    this.botToken = opts.botToken ?? ''
    this.baseUrl = (opts.baseUrl || WEIXIN_DEFAULT_BASE_URL).replace(/\/$/, '')
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private url(apiPath: string): string {
    return `${this.baseUrl}/${apiPath.replace(/^\//, '')}`
  }

  private async requestJson(
    method: 'GET' | 'POST',
    apiPath: string,
    opts: { params?: Record<string, string | number>; body?: unknown; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const timeoutMs = opts.timeoutMs ?? WEIXIN_DEFAULT_TIMEOUT_MS
    let full = this.url(apiPath)
    if (opts.params) {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(opts.params)) q.set(k, String(v))
      full += `?${q.toString()}`
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await this.fetchImpl(full, {
        method,
        headers: makeILinkHeaders(this.botToken),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ac.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`iLink HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`)
      }
      return (await res.json()) as Record<string, unknown>
    } finally {
      clearTimeout(timer)
    }
  }

  /** 取登录二维码 */
  async getBotQrcode(): Promise<BotQrcodeResult> {
    const data = await this.requestJson('GET', 'ilink/bot/get_bot_qrcode', {
      params: { bot_type: WEIXIN_BOT_TYPE },
    })
    const qrcode = String(data.qrcode ?? '')
    if (!qrcode) throw new Error('iLink get_bot_qrcode 未返回 qrcode')
    const img = data.qrcode_img_content != null ? String(data.qrcode_img_content) : undefined
    // 扫码内容优先官方返回的可扫描串;否则拼 liteapp 回退 URL
    const scanUrl =
      (typeof data.qrcode_img_content === 'string' && data.qrcode_img_content.startsWith('http')
        ? data.qrcode_img_content
        : null) ||
      (typeof data.scan_url === 'string' ? data.scan_url : null) ||
      `https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=${encodeURIComponent(qrcode)}&bot_type=${WEIXIN_BOT_TYPE}`
    return { qrcode, qrcodeImgContent: img, scanUrl }
  }

  /** 轮询扫码状态 */
  async getQrcodeStatus(qrcode: string): Promise<QrcodeStatusResult> {
    const data = await this.requestJson('GET', 'ilink/bot/get_qrcode_status', {
      params: { qrcode },
      timeoutMs: WEIXIN_QR_STATUS_TIMEOUT_MS,
    })
    return {
      status: String(data.status ?? ''),
      botToken: data.bot_token != null ? String(data.bot_token) : undefined,
      baseUrl: data.baseurl != null ? String(data.baseurl) : undefined,
      raw: data,
    }
  }

  /** 长轮询收消息 */
  async getUpdates(cursor = ''): Promise<Record<string, unknown>> {
    return this.requestJson('POST', 'ilink/bot/getupdates', {
      body: {
        get_updates_buf: cursor,
        base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
      },
      timeoutMs: WEIXIN_GETUPDATES_TIMEOUT_MS,
    })
  }

  /** 发文本(必须带 context_token) */
  async sendText(toUserId: string, text: string, contextToken: string): Promise<Record<string, unknown>> {
    if (!contextToken) throw new Error('微信回复需要 context_token(用户须先发言)')
    const msg = {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: randomUUID(),
      message_type: WEIXIN_MSG_TYPE_BOT,
      message_state: WEIXIN_MSG_STATE_FINISH,
      context_token: contextToken,
      item_list: [{ type: WEIXIN_ITEM_TYPE_TEXT, text_item: { text } }],
    }
    return this.requestJson('POST', 'ilink/bot/sendmessage', {
      body: { msg, base_info: { channel_version: WEIXIN_CHANNEL_VERSION } },
    })
  }
}
