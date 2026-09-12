// =============================================================
// M4: ChannelManager 契约测试(FakeAdapter 驱动全生命周期)
// 注册/五态派生/start 前置校验/ctx 组装/bridge.onStatus 聚合广播/test 转发
// 钉钉等新渠道接入时复用同一套断言。
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import type { ChannelManifest, ChannelStatusInfo } from '@shared/types'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    settings: {
      channels: {
        demo: { enabled: true, token: 'demo-token-value', mode: 'ws' },
      },
    } as Record<string, unknown>,
    secrets: {} as Record<string, string>,
  }
})

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => ''), isPackaged: false } }))
vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))
vi.mock('../../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => mocks.settings },
}))
vi.mock('../../../src/main/services/keystore-service', () => ({
  keystoreService: {
    getSecret: (key: string) => mocks.secrets[key] ?? null,
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
}))

import { channelManager } from '../../../src/main/services/channels/manager'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../../src/main/services/channels/types'

const DEMO_MANIFEST: ChannelManifest = {
  id: 'demo',
  label: '演示渠道',
  description: 'contract test',
  icon: 'demo',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'mode', label: '模式', type: 'string', required: true },
    { name: 'token', label: 'Token', type: 'secret', required: true },
  ],
}

class FakeAdapter implements ChannelAdapter {
  readonly id = 'demo'
  readonly manifest = DEMO_MANIFEST
  connectCalls = 0
  disconnectCalls = 0
  lastCtx: ChannelRuntimeContext | null = null
  runStatus: 'disabled' | 'connecting' | 'connected' | 'error' = 'disabled'

  validateConfig = vi.fn(async () => ({ ok: true } as const))
  async connect(ctx: ChannelRuntimeContext) {
    this.connectCalls++
    this.lastCtx = ctx
    ctx.bridge.onStatus({ status: 'connecting' })
    ctx.bridge.onStatus({ status: 'connected', connectedAt: 1234 })
  }
  async disconnect() {
    this.disconnectCalls++
  }
  getStatus() {
    return { status: this.runStatus }
  }
  getStats() {
    return { processingCount: 2, pendingCount: 3 }
  }
  async sendReply() {
    return {}
  }
  async push() {
    return {}
  }
}

function makeAdapter(): ChannelAdapter {
  return new FakeAdapter()
}

/** 独立 manager 实例的轻量替代:直接用单例但注册 demo(幂等) */
describe('ChannelManager 契约', () => {
  it('register 后 list() 包含实例,未配置 → not-configured', () => {
    channelManager.register(makeAdapter)
    mocks.secrets['demo-token'] = '' // 清空 secret
    mocks.settings.channels.demo = { enabled: true, mode: '' }
    const demo = channelManager.list().find((c) => c.manifest.id === 'demo')
    expect(demo).toBeDefined()
    expect(demo?.status.status).toBe('not-configured')
    expect(demo?.configured).toBe(false)
  })

  it('配置齐全 → configured;开关关闭 → disabled(与运行态正交)', () => {
    mocks.settings.channels.demo = { enabled: false, mode: 'ws' }
    mocks.secrets['demo-token'] = 'placeholder-not-real'
    let demo = channelManager.list().find((c) => c.manifest.id === 'demo')
    expect(demo?.configured).toBe(true)
    expect(demo?.enabled).toBe(false)
    expect(demo?.status.status).toBe('disabled')

    mocks.settings.channels.demo = { enabled: true, mode: 'ws' }
    demo = channelManager.list().find((c) => c.manifest.id === 'demo')
    expect(demo?.enabled).toBe(true)
  })

  it('未配置时 start() 抛错;配置后 start() 注入 ctx(config + getSecret)', async () => {
    mocks.settings.channels.demo = { enabled: true, mode: '' }
    await expect(channelManager.start('demo')).rejects.toThrow(/未配置/)

    mocks.settings.channels.demo = { enabled: true, mode: 'ws' }
    const adapter = channelManager.getAdapter('demo') as FakeAdapter
    await channelManager.start('demo')
    expect(adapter.connectCalls).toBe(1)
    expect(adapter.lastCtx?.config).toMatchObject({ mode: 'ws' })
    const secret = await adapter.lastCtx?.getSecret('token')
    expect(secret).toBe('placeholder-not-real')
  })

  it('bridge.onStatus → Manager 聚合计数后广播 status 事件', async () => {
    const seen: ChannelStatusInfo[] = []
    const listener = (info: ChannelStatusInfo) => seen.push(info)
    channelManager.on('status', listener)
    try {
      const adapter = channelManager.getAdapter('demo') as FakeAdapter
      adapter.connectCalls = 0
      await channelManager.start('demo')
      expect(adapter.connectCalls).toBe(1)
      const connected = seen.find((s) => s.status === 'connected')
      expect(connected).toMatchObject({
        channel: 'demo',
        status: 'connected',
        processingCount: 2,
        pendingCount: 3,
      })
    } finally {
      channelManager.removeListener('status', listener)
    }
  })

  it('stop() 转发 disconnect;test() 转发 validateConfig', async () => {
    const adapter = channelManager.getAdapter('demo') as FakeAdapter
    await channelManager.stop('demo', { userInitiated: true })
    expect(adapter.disconnectCalls).toBeGreaterThanOrEqual(1)

    const result = await channelManager.test('demo')
    expect(result.ok).toBe(true)
    expect(adapter.validateConfig).toHaveBeenCalled()
  })

  it('未知渠道 start/test 报错', async () => {
    await expect(channelManager.start('nope')).rejects.toThrow(/未知渠道/)
    const r = await channelManager.test('nope')
    expect(r.ok).toBe(false)
  })
})
