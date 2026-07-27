// =============================================================
// Feishu Service — API 调用 / token 缓存 / 错误处理 测试
// 通过 mock global fetch 验证各导出函数
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// mock fetch
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

describe('feishu-service — testConnection', () => {
  it('成功获取 token 返回 success(token 被截断显示)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tok-123',
        expire: 7200,
      }),
    )
    const { testConnection } = await import('../../src/main/services/feishu-service')
    const r = await testConnection('app-id', 'app-secret')
    expect(r.success).toBe(true)
    // testConnection 出于安全截断 token 显示(slice(0,8)+'...')
    expect(r.token).toContain('tok-123')
    expect(r.token).toContain('...')
    expect(r.expireSec).toBe(7200)
  })

  it('code !== 0 时返回 failure', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ code: 9999, msg: 'invalid app_id' }),
    )
    const { testConnection } = await import('../../src/main/services/feishu-service')
    const r = await testConnection('bad-id', 'bad-secret')
    expect(r.success).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('网络错误返回 failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network timeout'))
    const { testConnection } = await import('../../src/main/services/feishu-service')
    const r = await testConnection('x', 'y')
    expect(r.success).toBe(false)
    expect(r.error).toContain('network timeout')
  })

  it('空 appId/secret 返回 failure', async () => {
    const { testConnection } = await import('../../src/main/services/feishu-service')
    const r = await testConnection('', '')
    expect(r.success).toBe(false)
  })
})

describe('feishu-service — token 缓存 (getTenantToken 内部)', () => {
  it('getTenantToken 第二次调用应命中缓存', async () => {
    // testConnection 每次清缓存,但内部 getTenantToken 有缓存逻辑
    // 直接验证: 同一模块实例内多次 token 请求只 fetch 一次
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'cached-tok',
        expire: 7200,
      }),
    )
    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    // 两次发消息,token 应缓存(只 fetch token 一次 + 2 次发消息 = 3 次)
    await sendTextMessage('app', 'secret', 'user1', 'hello')
    await sendTextMessage('app', 'secret', 'user2', 'world')
    // 第一次: token + send = 2; 第二次: 缓存命中, 只 send = 1 → 总 3
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('feishu-service — sendTextMessage', () => {
  it('成功发送消息', async () => {
    // 先 mock token, 再 mock 发消息
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({
          code: 0,
          msg: 'ok',
          tenant_access_token: 'tok',
          expire: 7200,
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ code: 0, msg: 'ok', data: { message_id: 'msg-1' } }),
      )
    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    const r = await sendTextMessage('app', 'secret', 'user-id', 'hello')
    expect(r.success).toBe(true)
  })

  it('消息 API 返回 code!==0 时失败', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ code: 0, msg: 'ok', tenant_access_token: 'tok', expire: 7200 }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ code: 230002, msg: 'user not found' }))
    const { sendTextMessage } = await import('../../src/main/services/feishu-service')
    const r = await sendTextMessage('app', 'secret', 'bad-user', 'hello')
    expect(r.success).toBe(false)
  })
})

describe('feishu-service — feishuInfo', () => {
  it('返回非空字符串', async () => {
    const { feishuInfo } = await import('../../src/main/services/feishu-service')
    const info = feishuInfo()
    expect(typeof info).toBe('string')
    expect(info.length).toBeGreaterThan(0)
  })
})

describe('feishu-service — listBitableTables', () => {
  it('成功返回表格列表', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ code: 0, msg: 'ok', tenant_access_token: 'tok', expire: 7200 }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          code: 0,
          msg: 'ok',
          data: { items: [{ table_id: 't1', name: '表1' }] },
        }),
      )
    const { listBitableTables } = await import('../../src/main/services/feishu-service')
    const r = await listBitableTables('app', 'secret', 'app-token')
    expect(r.success).toBe(true)
    expect(r.tables?.length).toBe(1)
  })
})

describe('feishu-service — syncBitableNow 防御', () => {
  it('缺少配置应返回 skipped', async () => {
    const { syncBitableNow } = await import('../../src/main/services/feishu-service')
    const r = await syncBitableNow('', '', '', '', '')
    expect(r.success).toBe(false)
  })
})
