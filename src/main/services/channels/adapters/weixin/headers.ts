// =============================================================
// adapters/weixin/headers — iLink 请求头(纯函数,易测)
// X-WECHAT-UIN: base64(str(random_uint32)) 防重放,每请求一换
// =============================================================

import { randomInt } from 'node:crypto'

/** 构造 iLink API 请求头;token 空时不带 Authorization(取码阶段) */
export function makeILinkHeaders(botToken = ''): Record<string, string> {
  const uinVal = randomInt(0, 0xffffffff)
  const uinB64 = Buffer.from(String(uinVal), 'utf8').toString('base64')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': uinB64,
  }
  if (botToken) {
    headers.Authorization = `Bearer ${botToken}`
  }
  return headers
}

/** 归一化 QR 状态字符串(官方偶发 scaned 拼写) */
export function normalizeQrStatus(
  raw: string,
): 'pending' | 'scanned' | 'confirmed' | 'expired' | 'error' {
  const s = (raw || '').toLowerCase().trim()
  if (s === 'waiting' || s === 'wait' || s === 'pending') return 'pending'
  if (s === 'scanned' || s === 'scaned') return 'scanned'
  if (s === 'confirmed' || s === 'confirm' || s === 'success') return 'confirmed'
  if (s === 'expired' || s === 'expire' || s === 'timeout') return 'expired'
  if (!s) return 'pending'
  return 'error'
}
