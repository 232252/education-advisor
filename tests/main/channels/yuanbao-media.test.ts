// =============================================================
// yuanbao media — COS upload helpers (mocked fetch)
// =============================================================

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildFileMsgBody,
  buildImageMsgBody,
  downloadAndUploadMedia,
  extractResourceId,
  guessMime,
  parseDataUrl,
  parseImageSize,
  resolveDownloadUrl,
  signCosRequest,
} from '../../../src/main/services/channels/adapters/yuanbao/media'
import { extractAttachmentsFromMsgBody } from '../../../src/main/services/channels/adapters/yuanbao/codec'

function png1x1(): Buffer {
  // Minimal 1x1 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

describe('yuanbao media helpers', () => {
  it('guessMime maps common extensions', () => {
    expect(guessMime('a.png')).toBe('image/png')
    expect(guessMime('b.MP3')).toBe('audio/mpeg')
    expect(guessMime('c.unknown')).toBe('application/octet-stream')
  })

  it('parseImageSize reads PNG dimensions', () => {
    const [w, h] = parseImageSize(png1x1())
    expect(w).toBe(1)
    expect(h).toBe(1)
  })

  it('signCosRequest is deterministic HMAC-SHA1 auth string', () => {
    const auth = signCosRequest({
      secretId: 'AKIDtest',
      secretKey: 'secret',
      method: 'PUT',
      pathname: '/path/obj.png',
      headers: { host: 'bucket.cos.ap-guangzhou.myqcloud.com', 'content-length': '10' },
      startTime: 1700000000,
      expiredTime: 1700001800,
    })
    expect(auth).toContain('q-sign-algorithm=sha1')
    expect(auth).toContain('q-ak=AKIDtest')
    expect(auth).toMatch(/q-signature=[a-f0-9]{40}/)
  })

  it('parseDataUrl decodes base64 payload', () => {
    const parsed = parseDataUrl('data:image/png;base64,' + png1x1().toString('base64'))
    expect(parsed?.mediaType).toBe('image/png')
    expect(parsed?.data.byteLength).toBeGreaterThan(10)
    expect(parsed?.suffix).toBe('.png')
  })

  it('buildImageMsgBody / buildFileMsgBody TIM elems', () => {
    const result = {
      url: 'https://cdn.example/r.png',
      filename: 'r.png',
      size: 12,
      mimeType: 'image/png',
      uuidHex: 'abc',
      width: 1,
      height: 1,
    }
    expect(buildImageMsgBody(result)[0]?.msg_type).toBe('TIMImageElem')
    expect(buildFileMsgBody({ ...result, mimeType: 'application/pdf', filename: 'a.pdf' })[0]?.msg_type).toBe(
      'TIMFileElem',
    )
  })

  it('extractResourceId from query', () => {
    expect(extractResourceId('https://x/y?resourceId=rid-1')).toBe('rid-1')
    expect(extractResourceId('https://x/y')).toBeNull()
  })
})

describe('yuanbao downloadAndUploadMedia (mocked)', () => {
  it('uploads data-URL image via genUploadInfo + COS PUT', async () => {
    const png = png1x1()
    const dataUrl = 'data:image/png;base64,' + png.toString('base64')
    const calls: Array<{ url: string; method?: string }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method })
      if (String(url).includes('/api/resource/genUploadInfo')) {
        return new Response(
          JSON.stringify({
            data: {
              bucketName: 'yb-bucket',
              region: 'ap-guangzhou',
              location: '/tmp/obj.png',
              encryptTmpSecretId: 'AKID',
              encryptTmpSecretKey: 'KEY',
              encryptToken: 'tok',
              startTime: 1700000000,
              expiredTime: 1700001800,
              resourceUrl: 'https://cdn.example/obj.png?resourceId=r1',
              resourceID: 'r1',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (String(url).includes('myqcloud.com')) {
        return new Response(null, { status: 200 })
      }
      return new Response('nope', { status: 404 })
    })

    const result = await downloadAndUploadMedia(
      dataUrl,
      fetchImpl as never,
      'bot.yuanbao.tencent.com',
      { 'X-ID': 'bot', 'X-Token': 't', 'X-Source': 'bot' },
    )
    expect(result.url).toContain('cdn.example')
    expect(result.mimeType).toBe('image/png')
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
    expect(result.uuidHex).toBe(createHash('md5').update(png).digest('hex'))
    expect(calls.some((c) => c.url.includes('genUploadInfo'))).toBe(true)
    expect(calls.some((c) => c.url.includes('myqcloud.com') && c.method === 'PUT')).toBe(true)
  })

  it('resolveDownloadUrl calls download API when resourceId present', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain('resourceId=r1')
      return new Response(JSON.stringify({ data: { url: 'https://real.example/f' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const resolved = await resolveDownloadUrl(
      'https://cdn.example/x?resourceId=r1',
      fetchImpl as never,
      'https://bot.yuanbao.tencent.com',
      { 'X-Token': 't' },
    )
    expect(resolved).toBe('https://real.example/f')
  })
})

describe('yuanbao inbound media parse', () => {
  it('extractAttachmentsFromMsgBody for image + file/audio', () => {
    const atts = extractAttachmentsFromMsgBody([
      {
        msg_type: 'TIMImageElem',
        msg_content: {
          image_info_array: [{ type: 1, size: 10, width: 2, height: 3, url: 'https://img' }],
        },
      },
      {
        msg_type: 'TIMFileElem',
        msg_content: { url: 'https://f', file_name: 'voice.mp3', file_size: 99 },
      },
      {
        msg_type: 'TIMFileElem',
        msg_content: { url: 'https://doc', file_name: 'a.pdf', file_size: 1 },
      },
    ])
    expect(atts).toHaveLength(3)
    expect(atts[0]?.type).toBe('image')
    expect(atts[0]?.url).toBe('https://img')
    expect(atts[1]?.type).toBe('audio')
    expect(atts[2]?.type).toBe('file')
  })
})
