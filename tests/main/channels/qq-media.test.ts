import { describe, expect, it, vi } from 'vitest'
import { QqApiClient } from '../../../src/main/services/channels/adapters/qq/api'
import {
  classifyQqMediaError,
  guessQqFileType,
  parseQqOutboundMediaMarkers,
} from '../../../src/main/services/channels/adapters/qq/media'

function tokenFetch(url: string) {
  if (String(url).includes('getAppAccessToken')) {
    return {
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
      text: async () => '',
      status: 200,
    }
  }
  return null
}

describe('qq rich-media /files outbound', () => {
  it('guessQqFileType + parse markers', () => {
    expect(guessQqFileType('a.PNG')).toBe(1)
    expect(guessQqFileType('report.pdf')).toBe(4)
    const parsed = parseQqOutboundMediaMarkers(
      '见图 [IMAGE:https://cdn.example/a.png] 与 [FILE:/tmp/x.pdf]',
    )
    expect(parsed.cleanedText).toContain('见图')
    expect(parsed.media).toHaveLength(2)
    expect(parsed.media[0]!.kind).toBe('image')
    expect(parsed.media[1]!.kind).toBe('file')
    expect(classifyQqMediaError(400, '{"code":40093002}')).toMatch(/配额|容量/)
    expect(classifyQqMediaError(400, '{"code":850031}')).toMatch(/大小/)
  })

  it('uploadMedia URL + sendMediaMessage msg_type=7', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const tok = tokenFetch(url)
      if (tok) return tok
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url: String(url), body })
      if (String(url).includes('/files')) {
        return {
          ok: true,
          json: async () => ({ file_info: 'FILEINFO123', file_uuid: 'u1', ttl: 300 }),
          text: async () => '',
          status: 200,
        }
      }
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 }
    }) as unknown as typeof fetch
    const api = new QqApiClient('app', 'sec', undefined, fetchImpl)
    await api.pushMedia({
      kind: 'c2c',
      openid: 'u1',
      media: { kind: 'image', source: 'https://cdn.example/a.png' },
    })
    const upload = calls.find((c) => c.url.includes('/files'))
    const send = calls.find((c) => c.url.includes('/messages'))
    expect(upload?.body.file_type).toBe(1)
    expect(upload?.body.url).toBe('https://cdn.example/a.png')
    expect(upload?.body.srv_send_msg).toBe(false)
    expect(send?.body.msg_type).toBe(7)
    expect((send?.body.media as { file_info?: string })?.file_info).toBe('FILEINFO123')
    expect(send?.body.msg_id).toBeUndefined()
  })

  it('replyMedia fails with readable quota error', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      void init
      const tok = tokenFetch(url)
      if (tok) return tok
      if (String(url).includes('/files')) {
        return {
          ok: false,
          json: async () => ({}),
          text: async () => '{"code":40093002,"message":"over capacity"}',
          status: 400,
        }
      }
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 }
    }) as unknown as typeof fetch
    const api = new QqApiClient('app', 'sec', undefined, fetchImpl)
    await expect(
      api.replyMedia(
        { kind: 'c2c', openid: 'u1', msgId: 'mid-9' },
        { kind: 'file', source: 'https://cdn.example/a.pdf', fileName: 'a.pdf' },
      ),
    ).rejects.toThrow(/配额|容量/)
  })

  it('pushOutbound sends media then text', async () => {
    const order: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const tok = tokenFetch(url)
      if (tok) return tok
      if (String(url).includes('/files')) {
        order.push('files')
        return {
          ok: true,
          json: async () => ({ file_info: 'FI' }),
          text: async () => '',
          status: 200,
        }
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      order.push(body.msg_type === 7 ? 'media-msg' : 'text-msg')
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 }
    }) as unknown as typeof fetch
    const api = new QqApiClient('app', 'sec', undefined, fetchImpl)
    await api.pushOutbound({
      kind: 'group',
      openid: 'm1',
      groupOpenid: 'g1',
      text: '说明 [IMAGE:https://cdn.example/x.jpg]',
    })
    expect(order).toEqual(['files', 'media-msg', 'text-msg'])
  })
})
