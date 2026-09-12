// =============================================================
// FeishuAdapter — 统一频道接口的飞书实现(M3)
// 覆盖 validateConfig 的字段校验(不依赖网络)与 getStatus 状态映射。
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
    userDataDir: '',
    getPath: vi.fn((n: string) => (n === 'userData' ? mocks.userDataDir : '')),
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class {},
  WSClient: class {},
  EventDispatcher: class {
    register() {
      return this
    }
  },
  Domain: { Feishu: 'feishu', Lark: 'lark' },
  AppType: { SelfBuild: 'self_build' },
  LoggerLevel: { warn: 'warn' },
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
vi.mock('../../../src/main/services/feishu/token', () => ({
  getTenantToken: vi.fn(async () => ({ token: 't', expire: 3600 })),
}))

import { FeishuAdapter } from '../../../src/main/services/channels/adapters/feishu'
import { feishuManifest } from '../../../src/main/services/channels/adapters/feishu/manifest'

const VALID_APP_ID = `cli_${'a'.repeat(16)}`
// 占位密钥:仅测试格式分支,非真实凭据
const PLACEHOLDER_SECRET = 'test-secret-placeholder'

function makeCtx(config: Record<string, unknown>, secret: string | null = PLACEHOLDER_SECRET) {
  return {
    config,
    getSecret: async () => secret,
  }
}

beforeAll(() => {
  mocks.userDataDir = ''
})

describe('FeishuAdapter.validateConfig', () => {
  const adapter = new FeishuAdapter()

  it('manifest 归一(id/能力位/表单声明)', () => {
    expect(adapter.id).toBe('feishu')
    expect(adapter.manifest).toBe(feishuManifest)
    expect(feishuManifest.capabilities.streamingKind).toBe('card-stream')
  })

  it('缺 App ID → 定位字段 appId', async () => {
    const r = await adapter.validateConfig(makeCtx({}))
    expect(r).toEqual({ ok: false, message: expect.any(String), field: 'appId' })
  })

  it('App ID 格式错误 → 定位字段 appId', async () => {
    const r = await adapter.validateConfig(makeCtx({ appId: 'not-a-cli-id' }))
    expect(r).toMatchObject({ ok: false, field: 'appId' })
  })

  it('缺 App Secret → 定位字段 appSecret', async () => {
    const r = await adapter.validateConfig(makeCtx({ appId: VALID_APP_ID }, null))
    expect(r).toMatchObject({ ok: false, field: 'appSecret' })
  })
})

describe('FeishuAdapter.getStatus', () => {
  it('未连接时映射为 disabled(具体配置态由 Manager 叠加)', () => {
    const adapter = new FeishuAdapter()
    const st = adapter.getStatus()
    expect(['disabled', 'error']).toContain(st.status)
  })
})
