import { describe, expect, it, vi } from 'vitest'
import { ILinkClient } from '../../../src/main/services/channels/adapters/weixin/ilink-client'

describe('ILinkClient smoke', () => {
  it('getUpdates posts cursor', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      expect(body.get_updates_buf).toBe('cur-1')
      return {
        ok: true,
        json: async () => ({ msgs: [], get_updates_buf: 'cur-2', ret: -1 }),
        text: async () => '',
        status: 200,
        statusText: 'OK',
      }
    }) as unknown as typeof fetch
    const client = new ILinkClient({ botToken: 't', fetchImpl })
    const data = await client.getUpdates('cur-1')
    expect(data.get_updates_buf).toBe('cur-2')
  })
})
