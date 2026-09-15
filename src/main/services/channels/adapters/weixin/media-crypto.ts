// =============================================================
// adapters/weixin/media-crypto — AES-128-ECB (PKCS7) for iLink CDN media
// 与官方/社区 TS parseAesKey 对齐: hex / base64(raw) / base64(hex) 三种密钥形态
// =============================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const BLOCK = 16

function pkcs7Pad(data: Buffer): Buffer {
  const pad = BLOCK - (data.length % BLOCK)
  return Buffer.concat([data, Buffer.alloc(pad, pad)])
}

function pkcs7Unpad(data: Buffer): Buffer {
  if (data.length === 0 || data.length % BLOCK !== 0) {
    throw new Error('Invalid PKCS7 block length')
  }
  const padByte = data[data.length - 1]
  if (padByte === undefined) throw new Error('Invalid PKCS7 block length')
  const pad = padByte
  if (pad < 1 || pad > BLOCK) throw new Error('Invalid PKCS7 padding')
  for (let i = 0; i < pad; i++) {
    if (data[data.length - 1 - i] !== pad) throw new Error('Invalid PKCS7 padding bytes')
  }
  return data.subarray(0, data.length - pad)
}

/** 解析 iLink 媒体密钥为 16/24/32 字节 */
export function parseAesKey(keyInput: string): Buffer {
  const raw = (keyInput || '').trim()
  if (!raw) throw new Error('Empty AES key')
  if ((raw.length === 32 || raw.length === 48 || raw.length === 64) && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }
  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    decoded = Buffer.from(raw, 'utf8')
  }
  if (decoded.length === 16 || decoded.length === 24 || decoded.length === 32) {
    return decoded
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]+$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error(`Unsupported AES key format (len=${decoded.length})`)
}

export function aesEcbDecrypt(data: Buffer, keyInput: string): Buffer {
  const key = parseAesKey(keyInput)
  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null)
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return pkcs7Unpad(decrypted)
}

export function aesEcbEncrypt(data: Buffer, keyB64Raw16: string): Buffer {
  const key = Buffer.from(keyB64Raw16, 'base64')
  if (key.length !== 16) throw new Error(`encrypt expects 16-byte key, got ${key.length}`)
  const cipher = createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  const padded = pkcs7Pad(data)
  return Buffer.concat([cipher.update(padded), cipher.final()])
}

/** 生成 16 字节随机密钥的 base64(原始字节) — 用于本地加解密 */
export function generateRawAesKeyB64(): string {
  return randomBytes(16).toString('base64')
}
