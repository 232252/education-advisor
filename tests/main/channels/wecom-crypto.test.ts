// =============================================================
// 企微附件 AES 解密 — 加解密往返与防篡改锚定:
//   AES-256-CBC / key=base64(aeskey) / IV=key前16字节 /
//   PKCS#7 按 32 字节块手工填充(Node 默认 padding 会 bad decrypt)
// =============================================================

import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { decryptWecomFile } from '../../../src/main/services/channels/adapters/wecom/crypto'

/** 官方 SDK 同款加密(镜像实现,用于往返验证) */
function encryptWecomFile(plain: Buffer, aesKeyBase64: string): Buffer {
  const key = Buffer.from(aesKeyBase64, 'base64')
  const iv = key.subarray(0, 16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  // PKCS#7 32 字节块填充(至少 1 字节,最多 32 字节整块)
  const padLen = 32 - (plain.length % 32)
  const padded = Buffer.concat([plain, Buffer.alloc(padLen, padLen)])
  return Buffer.concat([cipher.update(padded), cipher.final()])
}

function makeKey(): string {
  return randomBytes(32).toString('base64')
}

describe('decryptWecomFile', () => {
  it('加解密往返(空串/短文本/跨块长文本/整块对齐)', () => {
    const key = makeKey()
    const cases = [
      Buffer.from(''),
      Buffer.from('成绩单.csv'),
      Buffer.from('x'.repeat(31)), // 31 字节 → pad 1
      Buffer.from('y'.repeat(32)), // 32 字节 → pad 整块 32
      Buffer.from('z'.repeat(1024)),
    ]
    for (const plain of cases) {
      expect(decryptWecomFile(encryptWecomFile(plain, key), key).equals(plain)).toBe(true)
    }
  })

  it('aeskey 解码后非 32 字节 → 抛错', () => {
    expect(() => decryptWecomFile(Buffer.alloc(32), Buffer.from('short').toString('base64'))).toThrow(
      /长度非法/,
    )
  })

  it('填充字节被篡改 → 抛错', () => {
    const key = makeKey()
    const enc = encryptWecomFile(Buffer.from('hello'), key)
    // 最后一个填充字节改值(1 → 2),手工 PKCS#7 校验应拒绝
    enc[enc.length - 1] = (enc[enc.length - 1] + 1) % 256
    expect(() => decryptWecomFile(enc, key)).toThrow(/PKCS#7/)
  })

  it('密文被篡改 → bad decrypt 或填充校验失败', () => {
    const key = makeKey()
    const enc = encryptWecomFile(Buffer.from('secret-report'), key)
    enc[5] = (enc[5] + 1) % 256
    expect(() => decryptWecomFile(enc, key)).toThrow()
  })
})
