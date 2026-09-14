import { randomBytes, createCipheriv } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  decodePollToken,
  decryptBindSecret,
  encodePollToken,
  generateBindKey,
} from '../../../src/main/services/channels/adapters/qq/crypto-bind'
import { classifyQqSendError, QqApiClient } from '../../../src/main/services/channels/adapters/qq/api'
import {
  extractQqAttachments,
  parseQqDispatchEvent,
} from '../../../src/main/services/channels/adapters/qq/parsing'
import { qqManifest } from '../../../src/main/services/channels/adapters/qq/manifest'
import { validateManifest } from '../../../src/main/services/channels/manifest'

describe('qq full-feature parsing + push errors', () => {
  it('manifest receivesFiles + quota pushPolicy', () => {
    expect(validateManifest(qqManifest)).toEqual([])
    expect(qqManifest.limitationBannerKey).toBe('channels.qq.limitation')
    expect(qqManifest.capabilities.pushPolicy).toBe('quota')
    expect(qqManifest.capabilities.receivesFiles).toBe(true)
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

  it('extractQqAttachments 识别图片', () => {
    const atts = extractQqAttachments({
      attachments: [
        { url: 'https://cdn.example/a.png', content_type: 'image/png', filename: 'a.png' },
        { url: 'https://cdn.example/b.bin', filename: 'b.bin' },
      ],
    })
    expect(atts[0]!.kind).toBe('image')
    expect(atts[1]!.kind).toBe('file')
  })

  it('纯附件消息可解析', () => {
    const r = parseQqDispatchEvent(
      'C2C_MESSAGE_CREATE',
      {
        id: 'm3',
        content: '',
        author: { user_openid: 'u1' },
        attachments: [{ url: 'https://cdn.example/x.jpg', content_type: 'image/jpeg' }],
      },
      { allowGroups: true },
    )
    expect(r?.parsed.attachments).toHaveLength(1)
  })

  it('classifyQqSendError 配额文案', () => {
    const msg = classifyQqSendError(429, '{"code":11264,"message":"quota exceeded"}')
    expect(msg).toMatch(/配额/)
  })

  it('pushText 走官方路径且不带 msg_id', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('getAppAccessToken')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 7200 }),
          text: async () => '',
          status: 200,
        }
      }
      const body = JSON.parse(String(init?.body ?? '{}'))
      expect(body.msg_id).toBeUndefined()
      expect(typeof body.msg_seq).toBe('number')
      expect(body.content).toBe('主动通知')
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 }
    }) as unknown as typeof fetch
    const api = new QqApiClient('app', 'sec', undefined, fetchImpl)
    await api.pushText({ kind: 'c2c', openid: 'u1', text: '主动通知' })
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('replyText 带 msg_id + msg_seq', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('getAppAccessToken')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 7200 }),
          text: async () => '',
          status: 200,
        }
      }
      const body = JSON.parse(String(init?.body ?? '{}'))
      expect(body.msg_id).toBe('mid-1')
      expect(body.msg_seq).toBeGreaterThan(0)
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 }
    }) as unknown as typeof fetch
    const api = new QqApiClient('app', 'sec', undefined, fetchImpl)
    await api.replyText({ kind: 'c2c', openid: 'u1', msgId: 'mid-1' }, '回复')
  })

  it('AES-GCM bind secret roundtrip', () => {
    const keyB64 = generateBindKey()
    const key = Buffer.from(keyB64, 'base64')
    const iv = randomBytes(12)
    const plaintext = Buffer.from('secret-app-key', 'utf8')
    const cipher = createCipheriv('aes-256-gcm', key, iv)
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
