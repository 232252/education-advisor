// =============================================================
// WebUI 局域网安全 — 256-bit 持久令牌 / 绑定范围 / Origin / 限流
// 默认：局域网可达，但公网来源丢弃；令牌不轮换，长度固定。
// =============================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import net from 'node:net'
import os from 'node:os'

export const WEBUI_ACCESS_TOKEN_KEY = 'webui-access-token'
/** 旧 Cloudflare 隧道密钥，启动时清掉 */
export const LEGACY_CF_TUNNEL_SECRET_KEY = 'webui-cf-tunnel-token'
export const ACCESS_TOKEN_BYTES = 32
const MIN_TOKEN_CHARS = 32

export type WebUiProtocol = 'http' | 'https'
export type WebUiBind = 'loopback' | 'lan' | 'all'

export function generateAccessToken(): string {
  return randomBytes(ACCESS_TOKEN_BYTES).toString('base64url')
}

export function isUsableAccessToken(token: string): boolean {
  return (
    typeof token === 'string' && token.length >= MIN_TOKEN_CHARS && /^[A-Za-z0-9_-]+$/.test(token)
  )
}

export function tokenBits(token: string): number {
  if (!isUsableAccessToken(token)) return 0
  return Math.floor((token.length * 6) / 8) * 8
}

/** SHA-256 后再定长比较，避免长度/短路计时泄漏 */
export function tokensMatch(got: string, expected: string): boolean {
  if (!got || !expected) return false
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function normalizeRemoteAddress(addr?: string | null): string {
  if (!addr) return ''
  let a = addr.trim().toLowerCase()
  if (a.startsWith('::ffff:')) a = a.slice(7)
  const zone = a.indexOf('%')
  if (zone >= 0) a = a.slice(0, zone)
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1)
  return a
}

export function isLoopbackAddress(addr?: string | null): boolean {
  const a = normalizeRemoteAddress(addr)
  if (!a) return false
  if (a === '::1' || a === 'localhost') return true
  if (net.isIP(a) === 4) {
    const n = a.split('.').map(Number)
    return n[0] === 127
  }
  return false
}

export function expandIpv6(ip: string): string | null {
  const a = normalizeRemoteAddress(ip)
  if (!a || net.isIP(a) !== 6) return null
  if (a.includes('.')) return null
  const [leftRaw, rightRaw] = a.split('::')
  const left = leftRaw ? leftRaw.split(':').filter(Boolean) : []
  const right = a.includes('::') ? (rightRaw ? rightRaw.split(':').filter(Boolean) : []) : []
  if (!a.includes('::')) {
    if (left.length !== 8) return null
    return left.map((p) => p.padStart(4, '0')).join(':')
  }
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  return [...left, ...Array(missing).fill('0'), ...right].map((p) => p.padStart(4, '0')).join(':')
}

export function ipv6Prefix64(ip: string): string | null {
  const full = expandIpv6(ip)
  if (!full) return null
  return full.split(':').slice(0, 4).join(':')
}

function isRfc1918OrLinkLocalV4(ip: string): boolean {
  const n = ip.split('.').map(Number)
  if (n.length !== 4 || n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false
  const [a, b] = n
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function isPrivateOrLoopbackAddress(addr?: string | null): boolean {
  const a = normalizeRemoteAddress(addr)
  if (!a) return false
  if (isLoopbackAddress(a)) return true
  if (net.isIP(a) === 4) return isRfc1918OrLinkLocalV4(a)
  if (net.isIP(a) === 6) {
    const full = expandIpv6(a)
    if (!full) return false
    const head = parseInt(full.slice(0, 4), 16)
    if ((head & 0xfe00) === 0xfc00) return true
    if ((head & 0xffc0) === 0xfe80) return true
    return false
  }
  return false
}

export function localIpv6Prefix64s(): string[] {
  const out = new Set<string>()
  for (const addrs of Object.values(os.networkInterfaces())) {
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.internal) continue
      const ip = addr.address
      if (!ip || net.isIP(ip) !== 6) continue
      const prefix = ipv6Prefix64(ip)
      if (prefix && !prefix.startsWith('fe80:')) out.add(prefix)
    }
  }
  return [...out]
}

export function remoteAllowed(
  addr: string | null | undefined,
  bind: WebUiBind,
  localPrefixes: string[] = localIpv6Prefix64s(),
): boolean {
  const a = normalizeRemoteAddress(addr)
  if (!a) return false
  if (bind === 'all') return true
  if (bind === 'loopback') return isLoopbackAddress(a)
  if (isPrivateOrLoopbackAddress(a)) return true
  if (net.isIP(a) === 6) {
    const prefix = ipv6Prefix64(a)
    return Boolean(prefix && localPrefixes.includes(prefix))
  }
  return false
}

export function originAllowed(
  req: Pick<IncomingMessage, 'headers'>,
  protocol: WebUiProtocol,
): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const o = new URL(origin)
    if (o.protocol !== `${protocol}:`) return false
    const host = req.headers.host
    return Boolean(host && o.host === host)
  } catch {
    return false
  }
}

export function tokenFromRequest(req: IncomingMessage): string {
  const url = new URL(req.url || '/', 'https://webui.local')
  const q = url.searchParams.get('k')
  if (q) return q
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim())
    if (m?.[1]) return m[1]
  }
  const header = req.headers['x-ea-token']
  if (typeof header === 'string' && header) return header
  const cookie = req.headers.cookie || ''
  const m = /(?:^|;\s*)ea_k=([^;]+)/.exec(cookie)
  return m ? decodeURIComponent(m[1]) : ''
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `ea_k=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=31536000',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}

const FAIL_LIMIT = 12
const LOCK_MS = 30_000

export function createAuthGuard() {
  const fails = new Map<string, { n: number; lockUntil: number }>()
  return {
    blocked(ip: string): boolean {
      const key = normalizeRemoteAddress(ip) || ip
      const row = fails.get(key)
      if (!row) return false
      if (row.lockUntil && Date.now() < row.lockUntil) return true
      if (row.lockUntil && Date.now() >= row.lockUntil) {
        fails.delete(key)
        return false
      }
      return false
    },
    fail(ip: string): void {
      const key = normalizeRemoteAddress(ip) || ip
      const row = fails.get(key) || { n: 0, lockUntil: 0 }
      row.n += 1
      if (row.n >= FAIL_LIMIT) row.lockUntil = Date.now() + LOCK_MS
      fails.set(key, row)
    },
    ok(ip: string): void {
      fails.delete(normalizeRemoteAddress(ip) || ip)
    },
  }
}

export function listenHost(bind: WebUiBind, ipv6: boolean): string {
  if (bind === 'loopback') return ipv6 ? '127.0.0.1 / ::1' : '127.0.0.1'
  return ipv6 ? '::' : '0.0.0.0'
}
