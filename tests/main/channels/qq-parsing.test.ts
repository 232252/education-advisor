import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decodePollToken,
  decryptBindSecret,
  encodePollToken,
  generateBindKey,
} from '../../../src/main/services/channels/adapters/qq/crypto-bind'
import { parseQqDispatchEvent } from '../../../src/main/services/channels/adapters/qq/parsing'
import { qqManifest } from '../../../src/main/services/channels/adapters/qq/manifest'
import { validateManifest } from '../../../src/main/services/channels/manifest'

describe('qq parsing + crypto + manifest', () => {
  it('manifest 通过校验且显著限制 key 存在', () => {
    expect(validateManifest(qqManifest)).toEqual([])
    expect(qqManifest.limitationBannerKey).toBe('channels.qq.limitation')
    expect(qqManifest.loginKinds).toEqual(expect.arrayContaining(['qr', 'credentials']))
    expect(qqManifest.capabilities.pushPolicy).toBe('quota')
    expect(qqManifest.capabilities.streamingKind).toBe('none')
  })

  it('parse C2C_MESSAGE_CREATE', () => {
    const r = parseQqDispatchEvent(
      'C2C_MESSAGE_CREATE',
      {
        id: 'm1',
        content: '你好助教',
        author: { user_openid: 'u-openid' },
      },
      { allowGroups: true },
    )
    expect(r?.parsed.chatType).toBe('p2p')
    expect(r?.parsed.text).toBe('你好助教')
    expect(r?.delivery.kind).toBe('c2c')
  })

  it('群消息在 allowGroups=false 时过滤', () => {
    expect(
      parseQqDispatchEvent(
        'GROUP_AT_MESSAGE_CREATE',
        {
          id: 'm2',
          content: '<@!123> 提问',
          group_openid: 'g1',
          author: { member_openid: 'm1' },
        },
        { allowGroups: false },
      ),
    ).toBeNull()
  })

  it('AES-GCM bind secret roundtrip', () => {
    const keyB64 = generateBindKey()
    const key = Buffer.from(keyB64, 'base64')
    const iv = randomBytes(12)
    const plaintext = Buffer.from('secret-app-key', 'utf8')
    const cipher = require('node:crypto').createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const packed = Buffer.concat([iv, enc, tag]).toString('base64')
    expect(decryptBindSecret(packed, keyB64)).toBe('secret-app-key')
  })

  it('poll token encode/decode', () => {
    const token = encodePollToken('task-1', 'aes-key')
    expect(decodePollToken(token)).toEqual({ taskId: 'task-1', aesKey: 'aes-key' })
  })
})
