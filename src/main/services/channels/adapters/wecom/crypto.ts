// =============================================================
// adapters/wecom/crypto — 企微智能机器人附件 AES 解密(纯函数)
// 协议(官方 SDK decryptFile 同款): AES-256-CBC, key = base64(aeskey),
// IV = key 前 16 字节;PKCS#7 按 32 字节块填充,Node 默认去 padding 会
// bad decrypt → 关自动 padding 手工剥。
// =============================================================

import { createDecipheriv } from 'node:crypto'

/** 解密企微消息附件(image/file/video 的 url 内容) */
export function decryptWecomFile(encrypted: Buffer, aesKeyBase64: string): Buffer {
  const key = Buffer.from(aesKeyBase64, 'base64')
  if (key.length !== 32) {
    throw new Error(`aeskey 长度非法(期望 32 字节,实际 ${key.length})`)
  }
  const iv = key.subarray(0, 16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  // 手工剥 PKCS#7(32 字节块)
  const padLen = decrypted[decrypted.length - 1]
  if (padLen < 1 || padLen > 32 || padLen > decrypted.length) {
    throw new Error(`非法 PKCS#7 填充值: ${padLen}`)
  }
  for (let i = decrypted.length - padLen; i < decrypted.length; i++) {
    if (decrypted[i] !== padLen) throw new Error('PKCS#7 填充字节不一致')
  }
  return decrypted.subarray(0, decrypted.length - padLen)
}
