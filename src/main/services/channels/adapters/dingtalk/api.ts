// =============================================================
// adapters/dingtalk/api — 钉钉开放平台 HTTP API 封装
// 覆盖: accessToken(缓存/提前刷新) / sessionWebhook 文本回复 /
// downloadCode 两跳文件下载 / AI 卡片创建+投放+状态+流式帧 /
// 主动推送(群发/单聊批量)。请求体逐字段对照官方连接器
// DingTalk-Real-AI/dingtalk-openclaw-connector(2026-09-12 核验)。
//
// 卡片 API 全局令牌桶(官方约 40 QPS,保守 20)+ QpsLimit 退避重试一次,
// 防多会话并发打字机帧触发 403。
// fetch 可注入(vitest 用假 fetch 锚定请求形状)。
// =============================================================

import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { writeAttachmentBytes, type SavedAttachment } from '../../runtime/attachment-store'
import {
  AI_CARD_STATUS,
  CARD_API_MAX_QPS,
  DEFAULT_AI_CARD_TEMPLATE_ID,
  DINGTALK_API_BASE,
  QPS_BACKOFF_MS,
} from './constants'
import type { DingtalkDeliveryInfo } from './parsing'

/** 可注入的 fetch(Node 18+ 全局 fetch 同形) */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface DingtalkApiDeps {
  clientId: string
  clientSecret: string
  fetchImpl?: FetchLike
}

/** 钉钉 API 错误(带 HTTP 状态与平台错误码,QpsLimit 可识别) */
export class DingtalkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'DingtalkApiError'
  }

  /** 403 + code 含 QpsLimit → 瞬时限流,退避后可重试 */
  get isQpsLimit(): boolean {
    return this.status === 403 && typeof this.code === 'string' && this.code.includes('QpsLimit')
  }
}

/** 卡片 API 全局令牌桶(所有会话的打字机帧共享;进程内单例) */
class CardRateLimiter {
  private tokens = CARD_API_MAX_QPS
  private lastRefill = Date.now()
  private backoffUntil = 0
  private queueTail: Promise<unknown> = Promise.resolve()

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    if (elapsed > 0) {
      this.tokens = Math.min(CARD_API_MAX_QPS, this.tokens + elapsed * CARD_API_MAX_QPS)
      this.lastRefill = now
    }
  }

  /** 取一个令牌(串行化保证并发下不超发);返回等待的毫秒数 */
  async waitForToken(): Promise<number> {
    const prev = this.queueTail
    let release!: () => void
    this.queueTail = new Promise<void>((r) => {
      release = r
    })
    let waited = 0
    try {
      await prev
      const backoffWait = this.backoffUntil - Date.now()
      if (backoffWait > 0) {
        await sleep(backoffWait)
        waited += backoffWait
      }
      this.refill()
      if (this.tokens < 1) {
        const waitMs = Math.ceil(((1 - this.tokens) / CARD_API_MAX_QPS) * 1000)
        await sleep(waitMs)
        waited += waitMs
        this.refill()
      }
      this.tokens -= 1
      return waited
    } finally {
      release()
    }
  }

  triggerBackoff(): void {
    this.backoffUntil = Date.now() + QPS_BACKOFF_MS
    this.tokens = 0
    this.lastRefill = this.backoffUntil
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 进程级共享限流器(卡片 API 按企业维度限流,跨连接共享) */
const cardRateLimiter = new CardRateLimiter()

/** 单连接的钉钉 API 客户端(引擎 start 时按凭证构造) */
export class DingtalkApiClient {
  private token: string | null = null
  private tokenExpireAt = 0
  private readonly fetchImpl: FetchLike

  constructor(private readonly deps: DingtalkApiDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  /** robotCode: 企业内部应用机器人 = Client ID(官方连接器同款约定) */
  get robotCode(): string {
    return this.deps.clientId
  }

  /** access token(缓存;过期前 60s 刷新) */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt - 60_000) return this.token
    const resp = await this.rawJson('POST', '/v1.0/oauth2/accessToken', {
      appKey: this.deps.clientId,
      appSecret: this.deps.clientSecret,
    })
    const token = typeof resp.accessToken === 'string' ? resp.accessToken : ''
    const expireIn = Number(resp.expireIn ?? 0)
    if (!token) throw new Error('钉钉 accessToken 获取失败(响应缺 accessToken)')
    this.token = token
    this.tokenExpireAt = Date.now() + (expireIn > 0 ? expireIn : 7200) * 1000
    return token
  }

  /** 凭证预检(测试连接): 只取 token,不建长连接 */
  async validateCredentials(): Promise<string | null> {
    try {
      this.token = null
      await this.getAccessToken()
      return null
    } catch (err) {
      const e = err instanceof DingtalkApiError ? err : null
      if (e && (e.status === 401 || e.code === 'invalidClientSecret' || e.status === 400)) {
        return 'Client ID 或 Client Secret 不正确'
      }
      return `钉钉凭证校验失败: ${errText(err)}`
    }
  }

  /** sessionWebhook 文本回复(命令回执/降级链;atUserIds 群聊 @发送者) */
  async replyText(webhook: string, text: string, atUserIds: string[] = []): Promise<void> {
    const body: Record<string, unknown> = { msgtype: 'text', text: { content: text } }
    if (atUserIds.length > 0) body.at = { atUserIds, isAtAll: false }
    const resp = await this.fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw await apiError(resp)
  }

  /** 机器人主动群消息(cron 通知/告警) */
  async pushGroupMessage(openConversationId: string, text: string): Promise<void> {
    await this.authedJson('POST', '/v1.0/robot/groupMessages/send', {
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: text }),
      openConversationId,
      robotCode: this.robotCode,
    })
  }

  /** 机器人主动单聊消息(一次最多 20 人,这里单发) */
  async pushOtoMessage(userId: string, text: string): Promise<void> {
    await this.authedJson('POST', '/v1.0/robot/oToMessages/batchSend', {
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: text }),
      robotCode: this.robotCode,
      userIds: [userId],
    })
  }

  /** downloadCode → 临时下载 URL(第一跳) */
  async getMessageFileDownloadUrl(downloadCode: string): Promise<string> {
    const resp = await this.authedJson('POST', '/v1.0/robot/messageFiles/download', {
      robotCode: this.robotCode,
      downloadCode,
    })
    const url = typeof resp.downloadUrl === 'string' ? resp.downloadUrl : ''
    if (!url) throw new Error('钉钉文件下载失败(响应缺 downloadUrl)')
    return url
  }

  /** 下载附件并安全落盘(第二跳 GET 临时 URL → writeAttachmentBytes) */
  async downloadAttachment(opts: {
    downloadCode: string
    fileName?: string
    kind: 'file' | 'image'
    dir: string
  }): Promise<{ ok: true; saved: SavedAttachment } | { ok: false; error: string }> {
    try {
      const url = await this.getMessageFileDownloadUrl(opts.downloadCode)
      const resp = await this.fetchImpl(url, { method: 'GET' })
      if (!resp.ok) throw await apiError(resp)
      const bytes = new Uint8Array(await resp.arrayBuffer())
      return await writeAttachmentBytes({
        bytes,
        fileName: opts.fileName,
        kind: opts.kind,
        dir: opts.dir,
        logScope: 'dingtalk',
      })
    } catch (err) {
      log('warn', 'dingtalk', `download attachment failed: ${errText(err)}`)
      return { ok: false, error: `《${opts.fileName ?? '文件'}》下载失败: ${errText(err)}` }
    }
  }

  // ===========================================================
  // AI 卡片(公共模板;创建 → 投放 → INPUTING → streaming 帧 → FINISHED)
  // ===========================================================

  /** 创建流式卡片实例,返回 outTrackId(卡片幂等 ID) */
  async createStreamCard(templateId?: string): Promise<string> {
    const outTrackId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    await this.authedJson(
      'POST',
      '/v1.0/card/instances',
      {
        cardTemplateId: templateId?.trim() || DEFAULT_AI_CARD_TEMPLATE_ID,
        outTrackId,
        cardData: { cardParamMap: { config: JSON.stringify({ autoLayout: true }) } },
        callbackType: 'STREAM',
        imGroupOpenSpaceModel: { supportForward: true },
        imRobotOpenSpaceModel: { supportForward: true },
      },
      { rateLimited: true },
    )
    return outTrackId
  }

  /** 投放卡片到会话(群聊 IM_GROUP / 单聊 IM_ROBOT) */
  async deliverCard(outTrackId: string, delivery: DingtalkDeliveryInfo): Promise<void> {
    const base = { outTrackId, userIdType: 1 }
    const body =
      delivery.conversationType === '2'
        ? {
            ...base,
            openSpaceId: `dtv1.card//IM_GROUP.${delivery.conversationId}`,
            imGroupOpenDeliverModel: { robotCode: this.robotCode },
          }
        : {
            ...base,
            openSpaceId: `dtv1.card//IM_ROBOT.${delivery.senderStaffId}`,
            imRobotOpenDeliverModel: {
              spaceType: 'IM_ROBOT',
              robotCode: this.robotCode,
              extension: { dynamicSummary: 'true' },
            },
          }
    await this.authedJson('POST', '/v1.0/card/instances/deliver', body, { rateLimited: true })
  }

  /** 切换卡片流控状态(INPUTING 打字机 / FINISHED 完成 / FAILED 失败) */
  async putCardStatus(
    outTrackId: string,
    flowStatus: (typeof AI_CARD_STATUS)[keyof typeof AI_CARD_STATUS],
    content: string,
  ): Promise<void> {
    await this.authedJson(
      'PUT',
      '/v1.0/card/instances',
      {
        outTrackId,
        cardData: {
          cardParamMap: {
            flowStatus,
            msgContent: content,
            staticMsgContent: '',
            sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
            config: JSON.stringify({ autoLayout: true }),
          },
        },
        cardUpdateOptions: { updateCardDataByKey: true },
      },
      { rateLimited: true },
    )
  }

  /** 发送一帧流式内容(isFull=true 全量;isFinalize=true 结束流式) */
  async putStreamingFrame(opts: {
    outTrackId: string
    content: string
    isFinalize: boolean
    isError?: boolean
  }): Promise<void> {
    await this.authedJson(
      'PUT',
      '/v1.0/card/streaming',
      {
        outTrackId: opts.outTrackId,
        guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        key: 'msgContent',
        content: opts.content,
        isFull: true,
        isFinalize: opts.isFinalize,
        isError: opts.isError === true,
      },
      { rateLimited: true },
    )
  }

  // ===========================================================
  // 内部:请求基建
  // ===========================================================

  /** 带 access token 的 API 调用;QpsLimit 退避后重试一次 */
  private async authedJson(
    method: string,
    apiPath: string,
    body: Record<string, unknown>,
    opts: { rateLimited?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const call = async (): Promise<Record<string, unknown>> => {
      const token = await this.getAccessToken()
      return this.rawJson(method, apiPath, body, {
        'x-acs-dingtalk-access-token': token,
      })
    }
    if (!opts.rateLimited) return call()
    await cardRateLimiter.waitForToken()
    try {
      return await call()
    } catch (err) {
      if (err instanceof DingtalkApiError && err.isQpsLimit) {
        cardRateLimiter.triggerBackoff()
        log('warn', 'dingtalk', `card api qps limited (${apiPath}), backoff ${QPS_BACKOFF_MS}ms`)
        await cardRateLimiter.waitForToken()
        return call()
      }
      throw err
    }
  }

  /** 裸 API 调用(统一错误归一为 DingtalkApiError) */
  private async rawJson(
    method: string,
    apiPath: string,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    let resp: Response
    try {
      resp = await this.fetchImpl(`${DINGTALK_API_BASE}${apiPath}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`钉钉网络请求失败(${apiPath}): ${errText(err)}`)
    }
    if (!resp.ok) throw await apiError(resp)
    if (resp.status === 204) return {}
    const text = await resp.text()
    if (!text.trim()) return {}
    try {
      const parsed: unknown = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
}

/** 响应 → DingtalkApiError(带平台 code) */
async function apiError(resp: Response): Promise<DingtalkApiError> {
  let code: string | undefined
  let msg = `${resp.status} ${resp.statusText}`
  try {
    const body = (await resp.json()) as { code?: unknown; message?: unknown; msg?: unknown }
    if (typeof body.code === 'string') code = body.code
    else if (typeof body.code === 'number') code = String(body.code)
    const m = body.message ?? body.msg
    if (typeof m === 'string' && m) msg = m
  } catch {
    /* 非 JSON 错误体保持 HTTP 状态描述 */
  }
  return new DingtalkApiError(`钉钉 API 错误(${resp.status}${code ? ` code=${code}` : ''}): ${msg}`, resp.status, code)
}

/** 测试辅助: 重置模块级限流器状态(避免用例间退避残留) */
export function _resetCardRateLimiterForTest(): void {
  cardRateLimiter.triggerBackoff()
}
