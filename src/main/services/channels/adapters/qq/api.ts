// =============================================================
// adapters/qq/api — QQ OpenAPI 发消息(C2C / 群) + 配额感知主动推送
// =============================================================

import { QQ_DEFAULT_API_BASE } from './constants'
import type { QqDeliveryInfo } from './parsing'
import { fetchQqAccessToken, type FetchLike, type QqTokenCache } from './token'

const msgSeqMap = new Map<string, number>()

function nextMsgSeq(key: string): number {
  const n = (msgSeqMap.get(key) ?? 0) + 1
  msgSeqMap.set(key, n)
  if (msgSeqMap.size > 1000) {
    const keys = [...msgSeqMap.keys()].slice(0, 500)
    for (const k of keys) msgSeqMap.delete(k)
  }
  return n
}

/** 识别官方配额/窗口类错误,转为用户可读文案 */
export function classifyQqSendError(status: number, body: string): string {
  const lower = (body || '').toLowerCase()
  if (
    /quota|频率|限流|rate.?limit|11264|11265|304023|304024|too many/i.test(lower) ||
    status === 429
  ) {
    return `QQ 主动/群发配额已用尽或触发限流(HTTP ${status})。群主动消息配额极严;请改用飞书/钉钉/邮件,或等待配额恢复。详情: ${body.slice(0, 160)}`
  }
  if (/msg_id|reply.?window|过期|expired|304055|40034023/i.test(lower)) {
    return `QQ 被动回复窗口已过期(约 5 分钟)。请让用户再发一条消息后再回复。详情: ${body.slice(0, 160)}`
  }
  return `QQ send message HTTP ${status}: ${body.slice(0, 200)}`
}

export class QqApiClient {
  private tokenCache: QqTokenCache | null = null

  constructor(
    private readonly appId: string,
    private readonly clientSecret: string,
    private readonly apiBase = QQ_DEFAULT_API_BASE,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getToken(): Promise<string> {
    this.tokenCache = await fetchQqAccessToken(
      this.appId,
      this.clientSecret,
      this.fetchImpl,
      this.tokenCache,
    )
    return this.tokenCache.accessToken
  }

  async validateCredentials(): Promise<string | null> {
    try {
      await this.getToken()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /** 被动回复(带 msg_id + msg_seq) */
  async replyText(delivery: QqDeliveryInfo, text: string): Promise<void> {
    await this.sendText({
      kind: delivery.kind,
      openid: delivery.openid,
      groupOpenid: delivery.groupOpenid,
      text,
      msgId: delivery.msgId,
      seqKey: delivery.msgId,
    })
  }

  /**
   * 主动推送 — 走官方 OpenAPI(不带 msg_id)。
   * 配额耗尽时抛出可读错误,不静默拒绝。
   */
  async pushText(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    text: string
  }): Promise<void> {
    await this.sendText({
      kind: opts.kind,
      openid: opts.openid,
      groupOpenid: opts.groupOpenid,
      text: opts.text,
      seqKey: `${opts.kind}:${opts.groupOpenid || opts.openid}:push`,
    })
  }

  private async sendText(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    text: string
    msgId?: string
    seqKey: string
  }): Promise<void> {
    const token = await this.getToken()
    const base = this.apiBase.replace(/\/$/, '')
    const path =
      opts.kind === 'c2c'
        ? `/v2/users/${encodeURIComponent(opts.openid)}/messages`
        : `/v2/groups/${encodeURIComponent(opts.groupOpenid || '')}/messages`
    const body: Record<string, unknown> = {
      content: opts.text,
      msg_type: 0,
      msg_seq: nextMsgSeq(opts.seqKey),
    }
    if (opts.msgId) body.msg_id = opts.msgId
    const res = await this.fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(classifyQqSendError(res.status, t))
    }
  }
}
