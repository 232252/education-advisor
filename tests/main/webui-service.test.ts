// =============================================================
// webUiService — 编排层测试(子模块 schedule/security/gateway/tls
// 各有专测,这里测它们与状态机的协同):
//   syncFromSettings 开关/重启去重(startKey)、端口 EADDRINUSE 扫描、
//   HTTPS 自定义证书不可读回退、regenerateToken 强制重启、
//   openInBrowser 未监听拒绝、init 的遗留密钥清理与 tick 驱动。
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(() => path.join(os.tmpdir(), 'webui-svc-test')),
  getSettings: vi.fn(),
  getSecret: vi.fn(() => ''),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  startWebUiGateway: vi.fn(),
  openExternalUrl: vi.fn(),
  loadTlsFromFiles: vi.fn(() => null),
  ensureWebUiTls: vi.fn(async () => ({
    material: { cert: 'c', key: 'k' },
    fingerprintSha256: 'fp-256',
  })),
  listListenUrls: vi.fn(() => ['https://127.0.0.1:18765/?t=abc']),
  listDirectAccess: vi.fn(() => ({ loopback: [], lanIpv4: ['192.168.1.5'], lanIpv6: [] })),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
}))

vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: {
    ready: async () => {},
    getSecret: mocks.getSecret,
    setSecret: mocks.setSecret,
    deleteSecret: mocks.deleteSecret,
  },
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))

vi.mock('../../src/main/services/webui/gateway', () => ({
  startWebUiGateway: mocks.startWebUiGateway,
}))

vi.mock('../../src/main/services/webui/tls', () => ({
  ensureWebUiTls: mocks.ensureWebUiTls,
  loadTlsFromFiles: mocks.loadTlsFromFiles,
  listListenUrls: mocks.listListenUrls,
  listDirectAccess: mocks.listDirectAccess,
}))

vi.mock('../../src/main/utils/open-external', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

import { LEGACY_CF_TUNNEL_SECRET_KEY } from '../../src/main/services/webui/security'
import { webUiService } from '../../src/main/services/webui-service'

/** 基准设置: 默认 http/loopback/lan 语义见 asBind 缺省 */
function settings(overrides: Record<string, unknown> = {}) {
  return {
    general: {
      webUiMode: 'off',
      webUiPort: 18765,
      webUiProtocol: 'http',
      webUiBind: 'lan',
      webUiIpv6: true,
      webUiTlsCertPath: '',
      webUiTlsKeyPath: '',
      timezone: 'UTC',
      ...overrides,
    },
  }
}

function gatewayHandle(port: number) {
  return { port, close: vi.fn(async () => {}) }
}

describe('webUiService 编排层', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockReturnValue(settings())
    mocks.startWebUiGateway.mockImplementation(async (o: { port: number }) => gatewayHandle(o.port))
  })

  afterEach(async () => {
    await webUiService.shutdown()
  })

  it('mode=off: 不启动网关;getStatus 报未监听', async () => {
    await webUiService.syncFromSettings()
    expect(mocks.startWebUiGateway).not.toHaveBeenCalled()
    const st = webUiService.getStatus()
    expect(st.listening).toBe(false)
    expect(st.urls).toEqual([])
  })

  it('mode=always: 启动网关;相同设置重复 sync 不重启(startKey 去重)', async () => {
    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always' }))
    await webUiService.syncFromSettings()
    expect(mocks.startWebUiGateway).toHaveBeenCalledTimes(1)
    expect(webUiService.getStatus().listening).toBe(true)

    await webUiService.syncFromSettings()
    await webUiService.syncFromSettings()
    expect(mocks.startWebUiGateway).toHaveBeenCalledTimes(1)
  })

  it('设置变化(port)触发重启: 旧网关 close,新网关建立', async () => {
    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always', webUiPort: 18800 }))
    await webUiService.syncFromSettings()
    expect(webUiService.getStatus().port).toBe(18800)

    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always', webUiPort: 18900 }))
    await webUiService.syncFromSettings()
    expect(mocks.startWebUiGateway).toHaveBeenCalledTimes(2)
    expect(webUiService.getStatus().port).toBe(18900)
  })

  it('EADDRINUSE 逐 +1 扫描端口,最多 12 次', async () => {
    let n = 0
    mocks.startWebUiGateway.mockImplementation(async (o: { port: number }) => {
      n++
      if (n <= 2) {
        const e = new Error('in use') as NodeJS.ErrnoException
        e.code = 'EADDRINUSE'
        throw e
      }
      return gatewayHandle(o.port)
    })
    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always', webUiPort: 18765 }))
    await webUiService.syncFromSettings()
    expect(n).toBe(3)
    expect(webUiService.getStatus().port).toBe(18767)
    expect(webUiService.getStatus().error).toBeNull()
  })

  it('非 EADDRINUSE 失败不重试,lastError 呈现', async () => {
    mocks.startWebUiGateway.mockImplementation(async () => {
      const e = new Error('bad token') as NodeJS.ErrnoException
      e.code = 'EINVAL'
      throw e
    })
    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always' }))
    await webUiService.syncFromSettings()
    expect(mocks.startWebUiGateway).toHaveBeenCalledTimes(1)
    const st = webUiService.getStatus()
    expect(st.listening).toBe(false)
    expect(st.error).toContain('bad token')
  })

  it('https: 自定义证书路径给了但读不出 → 回退自签并提示', async () => {
    mocks.getSettings.mockReturnValue(
      settings({
        webUiMode: 'always',
        webUiProtocol: 'https',
        webUiTlsCertPath: 'C:/certs/x.pem',
        webUiTlsKeyPath: 'C:/certs/x.key',
      }),
    )
    await webUiService.syncFromSettings()
    const st = webUiService.getStatus()
    expect(st.listening).toBe(true)
    expect(st.usingCustomCert).toBe(false)
    expect(st.fingerprintSha256).toBe('fp-256')
    expect(st.error).toContain('回退为自签证书')
  })

  it('regenerateToken: 生成新令牌并强制网关重启', async () => {
    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always' }))
    await webUiService.syncFromSettings()
    const before = webUiService.getStatus().accessToken
    const r = await webUiService.regenerateToken()
    expect(r.success).toBe(true)
    const after = webUiService.getStatus().accessToken
    expect(after).not.toBe(before)
    expect(mocks.startWebUiGateway).toHaveBeenCalledTimes(2)
  })

  it('openInBrowser: 未监听返回结构化失败;监听时打开 127.0.0.1 地址', async () => {
    const r0 = await webUiService.openInBrowser()
    expect(r0.success).toBe(false)
    expect(r0.error).toContain('未在监听')

    mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always' }))
    await webUiService.syncFromSettings()
    const r1 = await webUiService.openInBrowser()
    expect(r1.success).toBe(true)
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://127.0.0.1:18765/?t=abc')
  })

  it('init: 清理遗留 CF tunnel 密钥并按 tick 周期再同步', async () => {
    vi.useFakeTimers()
    try {
      mocks.getSettings.mockReturnValue(settings({ webUiMode: 'always' }))
      await webUiService.init()
      expect(mocks.deleteSecret).toHaveBeenCalledWith(LEGACY_CF_TUNNEL_SECRET_KEY)
      const callsAfterInit = mocks.startWebUiGateway.mock.calls.length
      expect(callsAfterInit).toBe(1)

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)
      // 两次 tick,设置未变 → startKey 去重,不重启
      expect(mocks.startWebUiGateway.mock.calls.length).toBe(1)
    } finally {
      await webUiService.shutdown()
      vi.useRealTimers()
    }
  })
})
