// =============================================================
// QQ sendReply 统一引擎收敛 — 经 adapter 入口调用 replyOutbound
// =============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest'

const replyOutboundFromMessage = vi.fn(async () => {})
const createReplySessionFromMessage = vi.fn(() => ({
  update: vi.fn(),
  finalize: vi.fn(),
  fail: vi.fn(),
}))

vi.mock('../../../src/main/services/channels/adapters/qq/connection', () => ({
  qqBotService: {
    replyOutboundFromMessage,
    createReplySessionFromMessage,
    getApi: () => null,
    getStatus: () => ({ status: 'connected', processingCount: 0, pendingCount: 0 }),
    on: vi.fn(),
    removeListener: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('../../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => ({ channels: { qq: {} } }) },
}))

describe('QqBotAdapter sendReply convergence', () => {
  beforeEach(() => {
    replyOutboundFromMessage.mockClear()
    createReplySessionFromMessage.mockClear()
  })

  it('sendReply 走统一引擎 replyOutboundFromMessage', async () => {
    const { createQqAdapter } = await import(
      '../../../src/main/services/channels/adapters/qq/index'
    )
    const adapter = createQqAdapter()
    const msg = {
      channel: 'qq',
      providerMessageId: 'msg-1',
      chat: { id: 'u1', type: 'p2p' as const },
      sender: { id: 'u1' },
      text: 'hi',
      attachments: [],
      receivedAt: Date.now(),
    }
    await adapter.sendReply(msg, { kind: 'text', text: 'hello' })
    expect(replyOutboundFromMessage).toHaveBeenCalledWith('msg-1', 'hello', [])
  })

  it('createReplySession 可用', async () => {
    const { createQqAdapter } = await import(
      '../../../src/main/services/channels/adapters/qq/index'
    )
    const adapter = createQqAdapter()
    expect(adapter.createReplySession).toBeTypeOf('function')
    const msg = {
      channel: 'qq',
      providerMessageId: 'msg-2',
      chat: { id: 'u1', type: 'p2p' as const },
      sender: { id: 'u1' },
      text: 'hi',
      attachments: [],
      receivedAt: Date.now(),
    }
    const session = await adapter.createReplySession!(msg, '...')
    expect(createReplySessionFromMessage).toHaveBeenCalledWith('msg-2', [])
    expect(session.finalize).toBeTypeOf('function')
  })
})
