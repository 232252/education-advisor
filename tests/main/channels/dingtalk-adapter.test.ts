// =============================================================
// DingtalkAdapter — 统一频道接口的钉钉实现(阶段 2)
// 覆盖 validateConfig 字段校验(不依赖网络)与 getStatus 状态映射 + manifest。
// =============================================================

import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    getPath: vi.fn((n: string) => (n === 'userData' ? 'C:\\temp\\ea-test-userData' : '')),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}))

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

vi.mock('../../../src/main/services/agent-service', () => ({
  agentService: { listAgents: () => [], runAgent: vi.fn(), getHistory: () => [] },
}))

vi.mock('../../../src/main/services/eaa-bridge', () => ({
  eaaBridge: { execute: vi.fn() },
}))

vi.mock('../../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      channels: {
        dingtalk: { enabled: true, clientId: '', clientSecret: '', allowGroups: true, agentId: 'main', cardTemplateId: '' },
      },
    })),
  },
}))

import { createDingtalkAdapter } from '../../../src/main/services/channels/adapters/dingtalk'
import { dingtalkManifest } from '../../../src/main/services/channels/adapters/dingtalk/manifest'
import { validateManifest } from '../../../src/main/services/channels/manifest'

function makeCtx(config: Record<string, unknown>, secret: string | null = 'test-secret-placeholder') {
  return {
    config,
    getSecret: async () => secret,
  }
}

beforeAll(() => {
  void mocks.getPath('userData')
})

describe('DingtalkAdapter', () => {
  const adapter = createDingtalkAdapter()

  it('manifest 合法且不再 comingSoon', () => {
    expect(adapter.id).toBe('dingtalk')
    expect(adapter.manifest).toBe(dingtalkManifest)
    expect(validateManifest(dingtalkManifest)).toEqual([])
    expect(dingtalkManifest.comingSoon).toBeUndefined()
    expect(dingtalkManifest.capabilities.streamingKind).toBe('card-stream')
    expect(dingtalkManifest.capabilities.receivesVia).toBe('ws')
    // secret 字段不出现在非 secret 声明里(keystore 协议)
    expect(dingtalkManifest.configSchema.find((f) => f.name === 'clientSecret')?.type).toBe('secret')
  })

  it('缺 Client ID → 定位字段 clientId', async () => {
    const r = await adapter.validateConfig(makeCtx({}))
    expect(r).toEqual({ ok: false, message: expect.any(String), field: 'clientId' })
  })

  it('Client ID 带空白 → trim 后仍判空', async () => {
    const r = await adapter.validateConfig(makeCtx({ clientId: '   ' }))
    expect(r).toMatchObject({ ok: false, field: 'clientId' })
  })

  it('缺 Client Secret → 定位字段 clientSecret', async () => {
    const r = await adapter.validateConfig(makeCtx({ clientId: 'ding-123' }, null))
    expect(r).toMatchObject({ ok: false, field: 'clientSecret' })
  })

  it('未连接时 getStatus 映射为非运行态', () => {
    const st = adapter.getStatus()
    expect(['disabled', 'error']).toContain(st.status)
  })
})
