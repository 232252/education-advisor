import { describe, expect, it, vi } from 'vitest'
import { parseWeixinOutboundMediaMarkers, sendWeixinOutbound } from '../../../src/main/services/channels/adapters/weixin/outbound'

vi.mock('../../../src/main/services/channels/adapters/weixin/media', () => ({
  sendImageMessage: vi.fn(async () => ({ ret: 0 })),
  sendFileMessage: vi.fn(async () => ({ ret: 0 })),
}))

import { sendFileMessage, sendImageMessage } from '../../../src/main/services/channels/adapters/weixin/media'

describe('weixin outbound media wiring', () => {
  it('parses IMAGE/FILE markers', () => {
    const r = parseWeixinOutboundMediaMarkers('见图 [IMAGE:/tmp/a.png] 与 [FILE:/tmp/b.pdf] 完')
    expect(r.media).toHaveLength(2)
    expect(r.media[0]).toMatchObject({ kind: 'image', source: '/tmp/a.png' })
    expect(r.media[1]).toMatchObject({ kind: 'file', source: '/tmp/b.pdf' })
    expect(r.cleanedText).toContain('见图')
    expect(r.cleanedText).toContain('完')
    expect(r.cleanedText).not.toMatch(/\[IMAGE/)
    expect(r.cleanedText).not.toMatch(/\[FILE/)
  })

  it('sendWeixinOutbound calls image/file then text', async () => {
    vi.mocked(sendImageMessage).mockClear()
    vi.mocked(sendFileMessage).mockClear()
    const client = { sendText: vi.fn(async () => ({ ret: 0 })) } as any
    const delivery = { toUserId: 'u1', contextToken: 'tok' }
    await sendWeixinOutbound(client, delivery, 'hello [IMAGE:/tmp/x.jpg]', [
      { kind: 'file', source: '/tmp/y.bin', fileName: 'y.bin' },
    ])
    expect(sendFileMessage).toHaveBeenCalledWith(client, 'u1', '/tmp/y.bin', 'y.bin', 'tok')
    expect(sendImageMessage).toHaveBeenCalledWith(client, 'u1', '/tmp/x.jpg', 'tok')
    expect(client.sendText).toHaveBeenCalledWith('u1', 'hello', 'tok')
  })
})
