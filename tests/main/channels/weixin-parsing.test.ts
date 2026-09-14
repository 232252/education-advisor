import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ILinkClient } from '../../../src/main/services/channels/adapters/weixin/ilink-client'
import { aesEcbDecrypt, aesEcbEncrypt, generateRawAesKeyB64, parseAesKey } from '../../../src/main/services/channels/adapters/weixin/media-crypto'
import {
  decodeWeixinMediaKey,
  encodeWeixinMediaKey,
  extractAttachmentsFromItems,
  extractTextFromItems,
  extractUpdatesPayload,
  parseWeixinMessage,
} from '../../../src/main/services/channels/adapters/weixin/parsing'
import { normalizeQrStatus } from '../../../src/main/services/channels/adapters/weixin/headers'
import { validateManifest } from '../../../src/main/services/channels/manifest'
import { weixinManifest } from '../../../src/main/services/channels/adapters/weixin/manifest'

describe('weixin full-feature parsing + media crypto', () => {
  it('manifest receivesFiles + pushPolicy', () => {
    expect(validateManifest(weixinManifest)).toEqual([])
    expect(weixinManifest.capabilities.receivesFiles).toBe(true)
    expect(weixinManifest.capabilities.pushPolicy).toBe('require-prior-message')
  })

  it('normalizeQrStatus 兼容官方拼写变体', () => {
    expect(normalizeQrStatus('waiting')).toBe('pending')
    expect(normalizeQrStatus('scaned')).toBe('scanned')
    expect(normalizeQrStatus('confirmed')).toBe('confirmed')
    expect(normalizeQrStatus('expired')).toBe('expired')
  })

  it('extractTextFromItems 含 voice ASR', () => {
    expect(
      extractTextFromItems([
        { type: 1, text_item: { text: '你好' } },
        { type: 3, voice_item: { text_item: { text: '语音转写' } } },
      ]),
    ).toBe('你好\n语音转写')
  })

  it('extractAttachmentsFromItems 解析图片与文件', () => {
    const atts = extractAttachmentsFromItems([
      {
        type: 2,
        image_item: {
          aeskey: '00112233445566778899aabbccddeeff',
          media: { encrypt_query_param: 'enc-img' },
        },
      },
      {
        type: 4,
        file_item: {
          file_name: 'a.pdf',
          media: { encrypt_query_param: 'enc-file', aes_key: 'abc' },
        },
      },
    ])
    expect(atts).toHaveLength(2)
    expect(atts[0]!.kind).toBe('image')
    expect(atts[1]!.fileName).toBe('a.pdf')
    const meta = decodeWeixinMediaKey(atts[0]!.fileKey)
    expect(meta?.encryptQueryParam).toBe('enc-img')
  })

  it('media key encode/decode roundtrip', () => {
    const key = encodeWeixinMediaKey({
      kind: 'image',
      encryptQueryParam: 'p',
      aesKey: 'k',
      fileName: 'x.jpg',
    })
    expect(decodeWeixinMediaKey(key)).toEqual({
      kind: 'image',
      encryptQueryParam: 'p',
      aesKey: 'k',
      fileName: 'x.jpg',
    })
  })

  it('parseWeixinMessage 支持纯图片消息', () => {
    const parsed = parseWeixinMessage({
      message_type: 1,
      from_user_id: 'u1@im.wechat',
      context_token: 'ctx-1',
      msg_id: 'm-img',
      item_list: [
        {
          type: 2,
          image_item: {
            media: { encrypt_query_param: 'enc', aes_key: 'k' },
          },
        },
      ],
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.inbound.attachments).toHaveLength(1)
    expect(parsed!.inbound.text).toContain('附件')
  })

  it('extractUpdatesPayload 读取 ret 与游标', () => {
    const { msgs, cursor, ret } = extractUpdatesPayload({
      msgs: [{ a: 1 }],
      get_updates_buf: 'buf-2',
      ret: -1,
    })
    expect(msgs).toHaveLength(1)
    expect(cursor).toBe('buf-2')
    expect(ret).toBe(-1)
  })

  it('AES-ECB roundtrip', () => {
    const keyB64 = generateRawAesKeyB64()
    const plain = Buffer.from('hello weixin media!!') // 20 bytes → pad
    const enc = aesEcbEncrypt(plain, keyB64)
    const dec = aesEcbDecrypt(enc, keyB64)
    expect(dec.equals(plain)).toBe(true)
    expect(parseAesKey(Buffer.from(keyB64, 'base64').toString('hex')).length).toBe(16)
  })

  it('AES decrypt accepts hex key', () => {
    const key = randomBytes(16)
    const hex = key.toString('hex')
    const cipher = createCipheriv('aes-128-ecb', key, null)
    cipher.setAutoPadding(true)
    const enc = Buffer.concat([cipher.update('pad-test-message!'), cipher.final()])
    const dec = aesEcbDecrypt(enc, hex)
    expect(dec.toString('utf8')).toBe('pad-test-message!')
  })
})

describe('ILinkClient dry-run extended', () => {
  it('getBotQrcode 解析 scanUrl', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ qrcode: 'QRCODE123', qrcode_img_content: 'ignored' }),
      text: async () => '',
      statusText: 'OK',
      status: 200,
    })) as unknown as typeof fetch
    const client = new ILinkClient({ fetchImpl })
    const qr = await client.getBotQrcode()
    expect(qr.qrcode).toBe('QRCODE123')
    expect(qr.scanUrl).toContain('QRCODE123')
  })

  it('sendText 拒绝空 context_token', async () => {
    const client = new ILinkClient({ botToken: 't' })
    await expect(client.sendText('u', 'hi', '')).rejects.toThrow(/context_token/)
  })

  it('getUploadUrl 组装 body', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      expect(body.media_type).toBe(1)
      expect(body.filekey).toBe('fk')
      return {
        ok: true,
        json: async () => ({ upload_full_url: 'https://cdn.example/upload' }),
        text: async () => '',
        statusText: 'OK',
        status: 200,
      }
    }) as unknown as typeof fetch
    const client = new ILinkClient({ botToken: 'tok', fetchImpl })
    const r = await client.getUploadUrl({
      filekey: 'fk',
      mediaType: 1,
      toUserId: 'u',
      rawsize: 10,
      rawfilemd5: 'd'.repeat(32),
      filesize: 16,
      aeskey: 'a'.repeat(32),
    })
    expect(r.upload_full_url).toContain('cdn.example')
  })
})
