// =============================================================
// yuanbao/auth — sign-token HMAC + token cache (QwenPaw yuanbao/auth.py)
// =============================================================

import { createHmac, randomBytes } from 'node:crypto'
import {
  DEFAULT_API_DOMAIN,
  RETRYABLE_SIGN_CODE,
  SIGN_MAX_RETRIES,
  SIGN_RETRY_DELAY_MS,
  SIGN_TOKEN_PATH,
  TOKEN_REFRESH_MARGIN_MS,
} from './constants'

export interface SignTokenResult {
  botId: string
  token: string
  source: string
  duration: number
  product: string
}

export function beijingTimestamp(now = new Date()): string {
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
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`
}

export function computeSignature(
  nonce: string,
  timestamp: string,
  appKey: string,
  appSecret: string,
): string {
  const payload = `${nonce}${timestamp}${appKey}${appSecret}`
  return createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex')
}

export function generateNonce(): string {
  return randomBytes(16).toString('hex')
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export class YuanbaoTokenManager {
  private cache: { data: SignTokenResult; expiresAt: number } | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private fetchImpl: FetchLike

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly apiDomain: string = DEFAULT_API_DOMAIN,
    fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init))
  }

  async getToken(): Promise<SignTokenResult> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data
    return this.doFetch()
  }

  async forceRefresh(): Promise<SignTokenResult> {
    this.cache = null
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    return this.doFetch()
  }

  close(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    this.cache = null
  }

  private normalizeDomain(): { scheme: string; host: string } {
    let domain = this.apiDomain.trim()
    let scheme = 'https'
    if (domain.startsWith('https://')) domain = domain.slice(8)
    else if (domain.startsWith('http://')) {
      scheme = 'http'
      domain = domain.slice(7)
    }
    return { scheme, host: domain.replace(/\/$/, '') }
  }

  private async doFetch(): Promise<SignTokenResult> {
    const { scheme, host } = this.normalizeDomain()
    const url = `${scheme}://${host}${SIGN_TOKEN_PATH}`

    let lastErr: Error | null = null
    for (let attempt = 0; attempt <= SIGN_MAX_RETRIES; attempt++) {
      const nonce = generateNonce()
      const timestamp = beijingTimestamp()
      const signature = computeSignature(nonce, timestamp, this.appId, this.appSecret)
      const body = {
        app_key: this.appId,
        nonce,
        signature,
        timestamp,
      }
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          throw new Error(`sign-token HTTP ${res.status} ${res.statusText}`)
        }
        const result = (await res.json()) as {
          code?: number
          msg?: string
          message?: string
          data?: {
            bot_id?: string
            token?: string
            source?: string
            duration?: number
            product?: string
          }
        }
        const code = result.code ?? -1
        if (code === 0 && result.data?.token) {
          const tokenResult: SignTokenResult = {
            botId: result.data.bot_id ?? '',
            token: result.data.token,
            source: result.data.source ?? 'bot',
            duration: result.data.duration ?? 0,
            product: result.data.product ?? 'yuanbao',
          }
          if (tokenResult.duration > 0) {
            this.cache = {
              data: tokenResult,
              expiresAt: Date.now() + tokenResult.duration * 1000,
            }
            this.scheduleRefresh(tokenResult.duration * 1000)
          }
          return tokenResult
        }
        if (code === RETRYABLE_SIGN_CODE && attempt < SIGN_MAX_RETRIES) {
          await sleep(SIGN_RETRY_DELAY_MS)
          continue
        }
        throw new Error(
          `sign-token error: code=${code}, msg=${result.msg ?? result.message ?? ''}`,
        )
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        if (attempt < SIGN_MAX_RETRIES) {
          await sleep(SIGN_RETRY_DELAY_MS)
          continue
        }
      }
    }
    throw lastErr ?? new Error('sign-token failed: max retries exceeded')
  }

  private scheduleRefresh(durationMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    const after = Math.max(durationMs - TOKEN_REFRESH_MARGIN_MS, 60_000)
    this.refreshTimer = setTimeout(() => {
      void this.forceRefresh().catch(() => undefined)
    }, after)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
