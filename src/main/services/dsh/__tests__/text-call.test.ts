import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDshRuntime: vi.fn(),
  completeSimpleViaDsh: vi.fn(),
  dshRouteFor: vi.fn(),
  dispose: vi.fn(async () => {}),
}))

vi.mock('../runtime', () => ({
  createDshRuntime: mocks.createDshRuntime,
}))

vi.mock('../one-shot', () => ({
  completeSimpleViaDsh: mocks.completeSimpleViaDsh,
}))

vi.mock('../route', () => ({
  dshRouteFor: mocks.dshRouteFor,
}))

import { completeDshText } from '../text-call'

describe('completeDshText', () => {
  beforeEach(() => {
    mocks.createDshRuntime.mockReset()
    mocks.completeSimpleViaDsh.mockReset()
    mocks.dshRouteFor.mockReset()
    mocks.dispose.mockClear()
    mocks.dshRouteFor.mockReturnValue({ providerId: 'deepseek', modelId: 'deepseek-chat' })
    mocks.createDshRuntime.mockReturnValue({ dispose: mocks.dispose, routeKey: 'k' })
  })

  it('按路由发一次文本请求，结束后关掉子进程', async () => {
    mocks.completeSimpleViaDsh.mockResolvedValue({ text: 'pong', usage: {} })
    const signal = new AbortController().signal

    const result = await completeDshText({
      provider: 'deepseek',
      model: 'deepseek-chat',
      text: 'ping',
      maxTokens: 5,
      signal,
    })

    expect(result).toEqual({ text: 'pong', stopReason: undefined })
    expect(mocks.createDshRuntime).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'deepseek-chat',
      maxTokens: 5,
    })
    expect(mocks.completeSimpleViaDsh).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        content: [{ type: 'text', text: 'ping' }],
        maxTokens: 5,
        signal,
      }),
    )
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
  })

  it('调用失败也关掉子进程', async () => {
    mocks.completeSimpleViaDsh.mockRejectedValue(new Error('boom'))
    await expect(
      completeDshText({ provider: 'deepseek', model: 'deepseek-chat', text: 'ping' }),
    ).rejects.toThrow('boom')
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
  })

  it('把还没保存的密钥交给这一次子进程', async () => {
    mocks.completeSimpleViaDsh.mockResolvedValue({ text: 'ok', usage: {} })
    await completeDshText({
      provider: 'kimi',
      model: 'k2',
      text: 'ping',
      apiKey: 'sk-unsaved',
    })
    expect(mocks.createDshRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        probeCredential: { providerId: 'kimi', apiKey: 'sk-unsaved' },
      }),
    )
  })
})
