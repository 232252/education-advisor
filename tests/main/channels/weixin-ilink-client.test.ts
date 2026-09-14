import { describe, expect, it, vi } from 'vitest'
import { ILinkClient } from '../../../src/main/services/channels/adapters/weixin/ilink-client'

describe('ILinkClient dry-run', () => {
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
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('sendText 拒绝空 context_token', async () => {
    const client = new ILinkClient({ botToken: 't' })
    await expect(client.sendText('u', 'hi', '')).rejects.toThrow(/context_token/)
  })
})
