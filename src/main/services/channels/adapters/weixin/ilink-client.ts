// =============================================================
// adapters/weixin/ilink-client — 自研 iLink HTTP 薄客户端
// 端点: get_bot_qrcode / get_qrcode_status / getupdates / sendmessage /
//       getconfig / sendtyping / getuploadurl (+ CDN via rawFetch)
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

  /** 通用 fetch(可跳过鉴权头,用于 CDN) */
  async rawFetch(
    fullUrl: string,
    opts: {
      method?: 'GET' | 'POST'
      body?: BodyInit | null
      headers?: Record<string, string>
      timeoutMs?: number
      auth?: boolean
    } = {},
  ): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? WEIXIN_DEFAULT_TIMEOUT_MS
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) }
      if (opts.auth !== false) {
        Object.assign(headers, makeILinkHeaders(this.botToken))
      }
      return await this.fetchImpl(fullUrl, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body ?? undefined,
        signal: ac.signal,
      })
    } finally {
      clearTimeout(timer)
    }
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
    const res = await this.rawFetch(full, {
      method,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
      timeoutMs,
      auth: true,
      headers: makeILinkHeaders(this.botToken),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`iLink HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }
    return (await res.json()) as Record<string, unknown>
  }

  /** 取登录二维码 */
  async getBotQrcode(): Promise<BotQrcodeResult> {
    const data = await this.requestJson('GET', 'ilink/bot/get_bot_qrcode', {
      params: { bot_type: WEIXIN_BOT_TYPE },
    })
    const qrcode = String(data.qrcode ?? '')
    if (!qrcode) throw new Error('iLink get_bot_qrcode 未返回 qrcode')
    const img = data.qrcode_img_content != null ? String(data.qrcode_img_content) : undefined
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

  /** 发原始消息体(文本/图片/文件共用) */
  async sendRawMessage(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestJson('POST', 'ilink/bot/sendmessage', {
      body: { msg, base_info: { channel_version: WEIXIN_CHANNEL_VERSION } },
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
    return this.sendRawMessage(msg)
  }

  /** 取 typing_ticket 等会话配置 */
  async getConfig(toUserId: string, contextToken = ''): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      to_user_id: toUserId,
      base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
    }
    if (contextToken) body.context_token = contextToken
    return this.requestJson('POST', 'ilink/bot/getconfig', { body })
  }

  /** 发送/刷新输入中状态 status=1 开始 / 0 停止 */
  async sendTyping(toUserId: string, typingTicket: string, status = 1): Promise<Record<string, unknown>> {
    return this.requestJson('POST', 'ilink/bot/sendtyping', {
      body: {
        to_user_id: toUserId,
        typing_ticket: typingTicket,
        status,
        base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
      },
    })
  }

  /** 申请媒体上传地址 */
  async getUploadUrl(params: {
    filekey: string
    mediaType: number
    toUserId: string
    rawsize: number
    rawfilemd5: string
    filesize: number
    aeskey: string
  }): Promise<Record<string, unknown>> {
    return this.requestJson('POST', 'ilink/bot/getuploadurl', {
      body: {
        filekey: params.filekey,
        media_type: params.mediaType,
        to_user_id: params.toUserId,
        rawsize: params.rawsize,
        rawfilemd5: params.rawfilemd5,
        filesize: params.filesize,
        aeskey: params.aeskey,
        base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
      },
      timeoutMs: 30_000,
    })
  }
}
