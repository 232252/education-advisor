// =============================================================
// adapters/qq/token — App Access Token(可注入 fetch)
// =============================================================

import { QQ_TOKEN_URL } from './constants'

export type FetchLike = typeof fetch

export interface QqTokenCache {
  accessToken: string
  expiresAt: number
}

export async function fetchQqAccessToken(
  appId: string,
  clientSecret: string,
  fetchImpl: FetchLike = fetch,
  cache?: QqTokenCache | null,
): Promise<QqTokenCache> {
  if (cache && cache.expiresAt > Date.now() + 60_000) return cache
  const res = await fetchImpl(QQ_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`getAppAccessToken HTTP ${res.status}: ${t.slice(0, 160)}`)
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error(`No access_token in response: ${JSON.stringify(data)}`)
  const expiresIn = Number(data.expires_in ?? 7200)
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }
}

export async function fetchQqGatewayUrl(
  accessToken: string,
  apiBase: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl(`${apiBase.replace(/\/$/, '')}/gateway`, {
    headers: { Authorization: `QQBot ${accessToken}` },
  })
  if (!res.ok) throw new Error(`QQ gateway HTTP ${res.status}`)
  const data = (await res.json()) as { url?: string }
  if (!data.url) throw new Error('QQ gateway response missing url')
  return data.url
}
