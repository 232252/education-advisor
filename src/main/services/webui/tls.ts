// =============================================================
// WebUI TLS — 自签证书(仅 HTTPS)。绑定 [::] 时 SAN 含 localhost / ::1 /
// 127.0.0.1 及当前网卡地址,证书落到 userData/webui-tls/
// =============================================================

import { createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { domainToASCII } from 'node:url'

const requireSelfsigned = createRequire(import.meta.url)
const selfsigned = requireSelfsigned('selfsigned') as {
  generate: (
    attrs: Array<{ name: string; value: string }>,
    opts: Record<string, unknown>,
  ) => { private: string; cert: string }
}

/** @deprecated 绑定地址改由 webUiBind + webUiIpv6 决定 */
export const WEBUI_BIND_HOST = '::' as const

export interface TlsMaterial {
  key: string
  cert: string
  fingerprintSha256: string
}

function asciiDns(name: string): string | null {
  if (!name || name.includes('%')) return null
  try {
    const ascii = domainToASCII(name)
    if (ascii && /^[A-Za-z0-9.-]+$/.test(ascii)) return ascii
  } catch {
    /* skip non-DNS hostnames — 中文计算机名会让 forge 产出非法 PEM */
  }
  return null
}

function collectHostnames(): { dns: string[]; ips: string[] } {
  const dns = new Set<string>(['localhost'])
  const ips = new Set<string>(['127.0.0.1', '::1'])
  const hostAscii = asciiDns(os.hostname())
  if (hostAscii) dns.add(hostAscii)
  for (const addrs of Object.values(os.networkInterfaces())) {
    if (!addrs) continue
    for (const addr of addrs) {
      const ip = addr.address
      if (!ip || ip.includes('%') || ip.toLowerCase().startsWith('fe80:')) continue
      if (net.isIP(ip)) ips.add(ip)
    }
  }
  return { dns: [...dns], ips: [...ips] }
}

function fingerprintOf(certPem: string): string {
  try {
    return new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()
  } catch {
    return createHash('sha256').update(certPem).digest('hex')
  }
}

function isUsablePair(key: string, cert: string): boolean {
  if (!key.includes('BEGIN') || !cert.includes('BEGIN CERTIFICATE')) return false
  try {
    createPrivateKey(key)
    const x509 = new X509Certificate(cert)
    return Boolean(x509.fingerprint256)
  } catch {
    return false
  }
}

function pemBlocks(text: string): Array<{ type: string; pem: string }> {
  const re = /-----BEGIN ([^-]+)-----[\s\S]*?-----END \1-----/g
  const out: Array<{ type: string; pem: string }> = []
  let m: RegExpExecArray | null = re.exec(text)
  while (m) {
    out.push({ type: m[1].trim().toUpperCase(), pem: m[0] })
    m = re.exec(text)
  }
  return out
}

function isCertBlock(type: string): boolean {
  return type.includes('CERTIFICATE') && !type.includes('REQUEST')
}

function isKeyBlock(type: string): boolean {
  return type.includes('PRIVATE KEY')
}

function keyToPem(buf: Buffer): string | null {
  const text = buf.toString('utf8')
  const fromPem = pemBlocks(text).find((b) => isKeyBlock(b.type))
  if (fromPem) {
    try {
      return createPrivateKey(fromPem.pem).export({ type: 'pkcs8', format: 'pem' }).toString()
    } catch {
      /* fall through to DER */
    }
  }
  const attempts: Array<Parameters<typeof createPrivateKey>[0]> = [
    buf,
    { key: buf, format: 'der', type: 'pkcs8' },
    { key: buf, format: 'der', type: 'pkcs1' },
    { key: buf, format: 'der', type: 'sec1' },
  ]
  for (const opt of attempts) {
    try {
      return createPrivateKey(opt).export({ type: 'pkcs8', format: 'pem' }).toString()
    } catch {
      /* next */
    }
  }
  return null
}

function certToPem(buf: Buffer): string | null {
  const text = buf.toString('utf8')
  const certs = pemBlocks(text)
    .filter((b) => isCertBlock(b.type))
    .map((b) => b.pem)
  if (certs.length) return certs.join('\n')
  try {
    return new X509Certificate(buf).toString()
  } catch {
    /* ignore */
  }
  try {
    return new X509Certificate(text).toString()
  } catch {
    return null
  }
}

function materialFromBuffers(keyBuf: Buffer, certBuf: Buffer): TlsMaterial | null {
  const keyPem = keyToPem(keyBuf) || keyToPem(certBuf)
  const certPem = certToPem(certBuf) || certToPem(keyBuf)
  if (!keyPem || !certPem || !isUsablePair(keyPem, certPem)) return null
  return { key: keyPem, cert: certPem, fingerprintSha256: fingerprintOf(certPem) }
}

function generatePems(): { private: string; cert: string } {
  const { dns, ips } = collectHostnames()
  const altNames = [
    ...dns.map((value) => ({ type: 2 as const, value })),
    ...ips.map((ip) => ({ type: 7 as const, ip })),
  ]
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Education Advisor WebUI' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
      },
      { name: 'subjectAltName', altNames },
    ],
  })
  if (!isUsablePair(pems.private, pems.cert)) {
    throw new Error('generated WebUI TLS material is not a valid PEM pair')
  }
  return { private: pems.private, cert: pems.cert }
}

export function loadTlsFromFiles(keyPath: string, certPath: string): TlsMaterial | null {
  const keyFile = keyPath.trim()
  const certFile = certPath.trim()
  if (!keyFile || !certFile) return null
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) return null
  try {
    const keyBuf = fs.readFileSync(keyFile)
    const certBuf = fs.readFileSync(certFile)
    return materialFromBuffers(keyBuf, certBuf)
  } catch {
    return null
  }
}

export function ensureWebUiTls(
  dir: string,
  custom?: { keyPath?: string; certPath?: string },
): TlsMaterial {
  const customTls = loadTlsFromFiles(custom?.keyPath || '', custom?.certPath || '')
  if (customTls) return customTls
  fs.mkdirSync(dir, { recursive: true })
  const keyPath = path.join(dir, 'key.pem')
  const certPath = path.join(dir, 'cert.pem')
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath, 'utf-8')
    const cert = fs.readFileSync(certPath, 'utf-8')
    if (isUsablePair(key, cert)) {
      return { key, cert, fingerprintSha256: fingerprintOf(cert) }
    }
  }
  const pems = generatePems()
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 })
  fs.writeFileSync(certPath, pems.cert, { mode: 0o644 })
  return { key: pems.private, cert: pems.cert, fingerprintSha256: fingerprintOf(pems.cert) }
}

export function formatAccessUrl(
  protocol: 'http' | 'https',
  hostname: string,
  port: number,
  token: string,
): string {
  const host = hostname.includes(':') ? `[${hostname}]` : hostname
  return `${protocol}://${host}:${port}/?k=${encodeURIComponent(token)}`
}

export function formatHttpsUrl(hostname: string, port: number, token: string): string {
  return formatAccessUrl('https', hostname, port, token)
}

export function listDirectAccess(
  port: number,
  token: string,
  opts: { protocol?: 'http' | 'https'; ipv6?: boolean; includeLan?: boolean } = {},
): {
  loopback: string[]
  lanIpv4: string[]
  lanIpv6: string[]
} {
  const protocol = opts.protocol ?? 'https'
  const ipv6 = opts.ipv6 !== false
  const includeLan = opts.includeLan !== false
  const loopback = [
    formatAccessUrl(protocol, '127.0.0.1', port, token),
    ...(ipv6 ? [formatAccessUrl(protocol, '::1', port, token)] : []),
    formatAccessUrl(protocol, 'localhost', port, token),
  ]
  const lanIpv4: string[] = []
  const lanIpv6: string[] = []
  if (includeLan) {
    for (const addrs of Object.values(os.networkInterfaces())) {
      if (!addrs) continue
      for (const addr of addrs) {
        if (addr.internal) continue
        const ip = addr.address
        if (!ip || ip.includes('%')) continue
        if (net.isIP(ip) === 6) {
          if (!ipv6 || ip.toLowerCase().startsWith('fe80:')) continue
          lanIpv6.push(formatAccessUrl(protocol, ip, port, token))
        } else if (net.isIP(ip) === 4) {
          lanIpv4.push(formatAccessUrl(protocol, ip, port, token))
        }
      }
    }
  }
  return { loopback, lanIpv4, lanIpv6 }
}

export function listListenUrls(
  port: number,
  token: string,
  opts: { protocol?: 'http' | 'https'; ipv6?: boolean; includeLan?: boolean } = {},
): string[] {
  const { loopback, lanIpv4, lanIpv6 } = listDirectAccess(port, token, opts)
  return [...loopback, ...lanIpv4, ...lanIpv6]
}
