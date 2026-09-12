// =============================================================
// WecomAibotAdapter — 统一频道接口的企微实现(阶段 3)
// 覆盖 manifest 契约、validateConfig 认证探针(注入假 ws-client)、
// 状态映射、push/sendReply/fetchAttachment 语义。
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
    // 假 WecomWsClient 探针行为开关
    probeFailAuth: false,
    probeInstances: [] as Array<{ connect: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
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
        wecom: { enabled: true, botId: '', secret: '', allowGroups: true, agentId: 'main' },
      },
    })),
  },
}))

vi.mock('../../../src/main/services/channels/bridge/agent-runner', () => ({
  runAgentStreaming: vi.fn(),
  runAgentAndCollect: vi.fn(),
}))

vi.mock('../../../src/main/services/channels/bridge/command-context', () => ({
  createCommandContext: vi.fn(() => ({}) as unknown as Record<string, unknown>),
}))

// 认证探针假实现: connect 按 probeFailAuth 决定成败
vi.mock('../../../src/main/services/channels/adapters/wecom/ws-client', () => ({
  WecomWsClient: class {
    connect = vi.fn(async () => {
      if (mocks.probeFailAuth) throw new Error('企微认证失败(errcode=40001);请检查 Bot ID 与长连接 Secret')
    })
    stop = vi.fn()
    constructor() {
      mocks.probeInstances.push(this)
    }
  },
}))

import { createWecomAdapter } from '../../../src/main/services/channels/adapters/wecom'
import { wecomManifest } from '../../../src/main/services/channels/adapters/wecom/manifest'
import { validateManifest } from '../../../src/main/services/channels/manifest'

function makeCtx(config: Record<string, unknown>, secret: string | null = 'ws-secret-placeholder') {
  return {
    config,
    getSecret: async () => secret,
  }
}

beforeAll(() => {
  void mocks.getPath('userData')
})

describe('WecomAibotAdapter', () => {
  const adapter = createWecomAdapter()

  it('manifest 合法且不再 comingSoon;能力位为 respond-stream', () => {
    expect(adapter.id).toBe('wecom')
    expect(adapter.manifest).toBe(wecomManifest)
    expect(validateManifest(wecomManifest)).toEqual([])
    expect(wecomManifest.comingSoon).toBeUndefined()
    expect(wecomManifest.capabilities.streamingKind).toBe('respond-stream')
    expect(wecomManifest.capabilities.receivesVia).toBe('ws')
    expect(wecomManifest.capabilities.pushPolicy).toBe('require-prior-message')
    expect(wecomManifest.capabilities.streamWindowMs).toBe(10 * 60 * 1000)
    // secret 字段声明(keystore 协议;默认键 wecom-secret)
    expect(wecomManifest.configSchema.find((f) => f.name === 'secret')?.type).toBe('secret')
    expect(wecomManifest.configSchema.find((f) => f.name === 'botId')?.required).toBe(true)
  })

  it('缺 Bot ID / 纯空白 → 定位字段 botId(不建连)', async () => {
    expect(await adapter.validateConfig(makeCtx({}))).toMatchObject({ ok: false, field: 'botId' })
    expect(await adapter.validateConfig(makeCtx({ botId: '   ' }))).toMatchObject({
      ok: false,
      field: 'botId',
    })
    expect(mocks.probeInstances).toHaveLength(0)
  })

  it('缺 Secret → 定位字段 secret(不建连)', async () => {
    const r = await adapter.validateConfig(makeCtx({ botId: 'bot-1' }, null))
    expect(r).toMatchObject({ ok: false, field: 'secret' })
    expect(mocks.probeInstances).toHaveLength(0)
  })

  it('探针成功 → ok 且探针即断开(不留长连接)', async () => {
    const r = await adapter.validateConfig(makeCtx({ botId: 'bot-1' }))
    expect(r).toEqual({ ok: true })
    const probe = mocks.probeInstances[mocks.probeInstances.length - 1]
    expect(probe.connect).toHaveBeenCalledTimes(1)
    expect(probe.stop).toHaveBeenCalledTimes(1)
  })

  it('探针认证失败 → ok:false + 可读错误 + 定位 secret', async () => {
    mocks.probeFailAuth = true
    try {
      const r = await adapter.validateConfig(makeCtx({ botId: 'bot-1' }))
      expect(r).toMatchObject({ ok: false, field: 'secret' })
      expect((r as { message?: string }).message).toMatch(/40001/)
    } finally {
      mocks.probeFailAuth = false
    }
  })

  it('未连接时 getStatus 映射为非运行态;getStats 为 0/0', () => {
    const st = adapter.getStatus()
    expect(['disabled', 'error']).toContain(st.status)
    expect(adapter.getStats?.()).toEqual({ processingCount: 0, pendingCount: 0 })
  })

  it('v1 语义: sendReply/fetchAttachment 不走适配器入口;push 未连接时抛错', async () => {
    await expect(
      adapter.sendReply(
        { messageId: 'm', chatId: 'c', chatType: 'p2p', text: 't', attachments: [] },
        { text: 'reply' },
      ),
    ).rejects.toThrow(/引擎流水线/)
    const att = await adapter.fetchAttachment(
      { messageId: 'm', chatId: 'c', chatType: 'p2p', text: 't', attachments: [] },
      { kind: 'file', fileKey: 'k' },
    )
    expect(att.ok).toBe(false)
    await expect(adapter.push({ chatId: 'c' }, { text: 'hi' })).rejects.toThrow(/未连接/)
  })
})
