// =============================================================
// adapters/qq/crypto-bind — QQ 门户 bind task AES-GCM 解密(纯函数)
// 门户 create_bind_task 用客户端生成的 AES key;完成时 bot_encrypt_secret
// 为 base64(iv[12] || ciphertext+tag)
// =============================================================

import { createDecipheriv, randomBytes } from 'node:crypto'

const AES_KEY_LENGTH = 32

/** 生成 base64 编码的 256-bit AES key */
export function generateBindKey(): string {
  return randomBytes(AES_KEY_LENGTH).toString('base64')
}

/** 解密门户返回的 bot_encrypt_secret */
export function decryptBindSecret(encryptedBase64: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64')
  const raw = Buffer.from(encryptedBase64, 'base64')
  if (raw.length < 28) {
    throw new Error(`Ciphertext too short: ${raw.length} bytes (min 28)`)
  }
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(raw.length - 16)
  const data = raw.subarray(12, raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** 无状态 poll token = urlsafe base64(json{task_id,key}) */
export function encodePollToken(taskId: string, aesKey: string): string {
  const payload = JSON.stringify({ task_id: taskId, key: aesKey })
  return Buffer.from(payload, 'utf8').toString('base64url')
}

export function decodePollToken(token: string): { taskId: string; aesKey: string } {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const data = JSON.parse(decoded) as { task_id?: string; key?: string }
    if (!data.task_id || !data.key) throw new Error('missing fields')
    return { taskId: data.task_id, aesKey: data.key }
  } catch (err) {
    throw new Error(`Invalid poll token: ${err instanceof Error ? err.message : err}`)
  }
}
