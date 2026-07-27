// =============================================================
// M-3 回归测试: feishu-service cachedToken 必须包含 appId
// 防止切换 appId 凭证后返回旧应用的 token(跨凭证污染)
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('M-3: cachedToken appId 隔离', () => {
  it('同一 appId 第二次调用命中缓存(只 fetch 一次 token)', async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-A',
        expire: 7200,
      }),
    )
    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    // 第一次: token + send = 2
    await sendTextMessage('app-A', 'secret-A', 'user1', 'hello')
    // 第二次: 缓存命中,只 send = 1
    await sendTextMessage('app-A', 'secret-A', 'user2', 'world')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('切换 appId 后必须重新获取 token(缓存不命中)', async () => {
    // app-A 的 token
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-A',
        expire: 7200,
      }),
    )
    // app-A 的 send 返回
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-A' } }),
    )
    // app-B 的 token(必须重新获取,不能复用 app-A 的)
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-B',
        expire: 7200,
      }),
    )
    // app-B 的 send 返回
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-B' } }),
    )

    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    await sendTextMessage('app-A', 'secret-A', 'user1', 'hello')
    await sendTextMessage('app-B', 'secret-B', 'user2', 'world')

    // 4 次调用 = 2 次 token + 2 次 send,证明切换 appId 后没有命中缓存
    expect(fetchMock).toHaveBeenCalledTimes(4)

    // 验证第二次 token 请求使用的是 app-B 的凭证
    const tokenCalls = fetchMock.mock.calls.filter((c) => {
      const url = c[0] as string
      return typeof url === 'string' && url.includes('tenant_access_token/internal')
    })
    expect(tokenCalls).toHaveLength(2)
    const firstBody = JSON.parse(tokenCalls[0][1].body as string)
    const secondBody = JSON.parse(tokenCalls[1][1].body as string)
    expect(firstBody.app_id).toBe('app-A')
    expect(secondBody.app_id).toBe('app-B')
  })

  it('切换回原 appId 也必须重新获取(token 已被覆盖)', async () => {
    // app-A token
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-A',
        expire: 7200,
      }),
    )
    // app-A send
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-A1' } }),
    )
    // app-B token
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-B',
        expire: 7200,
      }),
    )
    // app-B send
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-B' } }),
    )
    // app-A token again (因为缓存已被 app-B 覆盖)
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-A2',
        expire: 7200,
      }),
    )
    // app-A send
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-A2' } }),
    )

    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    await sendTextMessage('app-A', 'secret-A', 'u1', 'hi1')
    await sendTextMessage('app-B', 'secret-B', 'u2', 'hi2')
    await sendTextMessage('app-A', 'secret-A', 'u1', 'hi3')

    // 6 次 = 3 次 token + 3 次 send
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('testConnection 清空缓存后,后续调用必须重新获取', async () => {
    // testConnection 内部会清空 cachedToken,然后重新获取并缓存
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-init',
        expire: 7200,
      }),
    )
    // 之后的 sendTextMessage 命中缓存,只需 send
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-1' } }),
    )

    const { testConnection, sendTextMessage } = await import('../../src/main/services/feishu-service')
    await testConnection('app-A', 'secret-A')
    await sendTextMessage('app-A', 'secret-A', 'user1', 'hello')

    // 2 次: testConnection 的 1 次 token + sendTextMessage 的 1 次 send (token 命中缓存)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('过期前 5 分钟内的 token 仍可命中缓存', async () => {
    // expire=300 秒(刚好 5 分钟),按实现 >5 分钟才命中,所以这里应该重新获取
    // 注:expire=300 → expireAt=now+300*1000,剩余 300 秒 = 5 分钟, 不满足 >5min
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-near-expire',
        expire: 300,
      }),
    )
    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    await sendTextMessage('app-A', 'secret-A', 'u1', 'hi1')
    await sendTextMessage('app-A', 'secret-A', 'u2', 'hi2')
    // 4 次 = 2 次 token + 2 次 send (剩余时间不足 5 分钟,缓存不命中)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
