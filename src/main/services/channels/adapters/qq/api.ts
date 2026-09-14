// =============================================================
// adapters/qq/api — QQ OpenAPI 发消息(C2C / 群)
// =============================================================

import { QQ_DEFAULT_API_BASE } from './constants'
import type { QqDeliveryInfo } from './parsing'
import { fetchQqAccessToken, type FetchLike, type QqTokenCache } from './token'

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

  async replyText(delivery: QqDeliveryInfo, text: string): Promise<void> {
    const token = await this.getToken()
    const base = this.apiBase.replace(/\/$/, '')
    const path =
      delivery.kind === 'c2c'
        ? `/v2/users/${encodeURIComponent(delivery.openid)}/messages`
        : `/v2/groups/${encodeURIComponent(delivery.groupOpenid || '')}/messages`
    const body = {
      content: text,
      msg_type: 0,
      msg_id: delivery.msgId,
    }
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
      throw new Error(`QQ send message HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
  }
}
