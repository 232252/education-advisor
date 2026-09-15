// =============================================================
// adapters/qq/onboard — QQ 门户扫码绑定(create_bind_task / poll_bind_result)
// =============================================================

import {
  QQ_BIND_FRONTEND_PATH,
  QQ_BIND_SOURCE,
  QQ_CREATE_BIND_PATH,
  QQ_POLL_BIND_PATH,
  QQ_PORTAL_HOST,
} from './constants'
import { decodePollToken, decryptBindSecret, encodePollToken, generateBindKey } from './crypto-bind'

export type FetchLike = typeof fetch

export interface QqQrBeginResult {
  scanUrl: string
  pollToken: string
}

export type QqQrPollResult =
  | { status: 'pending' | 'scanned' | 'expired' | 'error'; message?: string }
  | {
      status: 'confirmed'
      credentials: { appId: string; clientSecret: string; userOpenId?: string }
    }

export async function beginQqQrBind(fetchImpl: FetchLike = fetch): Promise<QqQrBeginResult> {
  const aesKey = generateBindKey()
  const url = `https://${QQ_PORTAL_HOST}${QQ_CREATE_BIND_PATH}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: aesKey }),
  })
  if (!res.ok) {
    throw new Error(`QQ create_bind_task HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    retcode?: number
    msg?: string
    data?: { task_id?: string }
  }
  if (data.retcode !== 0) {
    throw new Error(`QQ create_bind_task error: ${data.msg || 'unknown'}`)
  }
  const taskId = data.data?.task_id
  if (!taskId) throw new Error('QQ create_bind_task returned empty task_id')
  const params = new URLSearchParams({
    task_id: taskId,
    _wv: '2',
    source: QQ_BIND_SOURCE,
  })
  const scanUrl = `https://${QQ_PORTAL_HOST}${QQ_BIND_FRONTEND_PATH}?${params.toString()}`
  return { scanUrl, pollToken: encodePollToken(taskId, aesKey) }
}

export async function pollQqQrBind(
  pollToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<QqQrPollResult> {
  let taskId: string
  let aesKey: string
  try {
    ;({ taskId, aesKey } = decodePollToken(pollToken))
  } catch {
    return { status: 'error', message: '无效的登录会话' }
  }
  const url = `https://${QQ_PORTAL_HOST}${QQ_POLL_BIND_PATH}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }),
  })
  if (!res.ok) {
    return { status: 'error', message: `poll_bind_result HTTP ${res.status}` }
  }
  const data = (await res.json()) as {
    retcode?: number
    msg?: string
    data?: {
      status?: number
      bot_appid?: string | number
      bot_encrypt_secret?: string
      user_openid?: string
    }
  }
  if (data.retcode !== 0) {
    return { status: 'error', message: data.msg || 'bind failed' }
  }
  const result = data.data ?? {}
  const st = result.status ?? -1
  if (st === 2) {
    const rawAppId = result.bot_appid
    const encrypted = result.bot_encrypt_secret ?? ''
    if (rawAppId == null || !encrypted) {
      return { status: 'error', message: 'Missing app_id or secret' }
    }
    try {
      const clientSecret = decryptBindSecret(encrypted, aesKey)
      return {
        status: 'confirmed',
        credentials: {
          appId: String(rawAppId),
          clientSecret,
          userOpenId: result.user_openid != null ? String(result.user_openid) : undefined,
        },
      }
    } catch {
      return { status: 'error', message: 'Secret decryption failed' }
    }
  }
  if (st === 3) return { status: 'expired' }
  // 0/1 = waiting / scanned(门户未细分 scanned 时一律 pending)
  if (st === 1) return { status: 'scanned' }
  return { status: 'pending' }
}
