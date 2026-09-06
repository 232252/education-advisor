// =============================================================
// MCP 工具发现与调用 — tool-operations 单元测试
// 覆盖: listToolsForAgent(feature gate/R8-5 缺失引用告警/单 server 失败
//       不阻塞/技能级覆盖同名/惰性 init)、callTool(R2-2 惰性重连/
//       无配置抛错/重连失败抛错)、listTools 断连空、testServer 三态
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig, McpTool } from '@shared/types'
import type { McpServiceContext } from '../../src/main/services/mcp-management/context'
import {
  callTool,
  listTools,
  listToolsForAgent,
  testServer,
} from '../../src/main/services/mcp-management/tool-operations'

const mocks = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  getSettings: vi.fn(() => ({ mcp: { enabled: true } })),
}))

vi.mock('../../src/main/services/mcp-management/lifecycle', () => mocks)
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))

const CFG = (id: string): McpServerConfig =>
  ({ id, name: id, transport: 'stdio', command: 'echo' }) as unknown as McpServerConfig
const TOOL = (name: string): McpTool =>
  ({ serverId: 's1', name, description: '', inputSchema: {} }) as McpTool

function makeCtx({
  configs = [],
  clients = {},
  ensureConnectedResults = new Map<string, Array<unknown>>(),
}: {
  configs?: McpServerConfig[]
  clients?: Record<string, { connected: boolean; tools?: McpTool[] }>
  ensureConnectedResults?: Map<string, Array<unknown>>
} = {}): McpServiceContext {
  const ensureConnected = vi.fn(async (cfg: McpServerConfig) => {
    const queue = ensureConnectedResults.get(cfg.id) ?? []
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next ?? { connected: true, tools: [TOOL(`${cfg.id}-t`)] }
  })
  const callToolInternal = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
  return {
    clientPool: {
      clientsMap: new Map(Object.entries(clients)),
      ensureConnected,
      callToolInternal,
    },
    configStore: { configList: configs },
    configPath: '/tmp/mcp.yaml',
    initialized: true,
  } as unknown as McpServiceContext
}

beforeEach(() => {
  mocks.init.mockClear()
  mocks.getSettings.mockClear()
  mocks.getSettings.mockImplementation(() => ({ mcp: { enabled: true } }))
})

describe('listToolsForAgent', () => {
  it('feature gate 关闭时返回空且不建立任何连接', async () => {
    mocks.getSettings.mockImplementation(() => ({ mcp: { enabled: false } }))
    const ctx = makeCtx({ configs: [CFG('s1')] })
    const tools = await listToolsForAgent(ctx, 'agent1', ['s1'])
    expect(tools).toEqual([])
    expect(ctx.clientPool.ensureConnected).not.toHaveBeenCalled()
  })

  it('未初始化时先走 init', async () => {
    const ctx = makeCtx()
    ctx.initialized = false
    await listToolsForAgent(ctx, 'agent1')
    expect(mocks.init).toHaveBeenCalledWith(ctx)
  })

  it('R8-5: 引用不存在的 server 告警并跳过,其余照常收集', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ctx = makeCtx({ configs: [CFG('good')] })
      const tools = await listToolsForAgent(ctx, 'agent1', ['typo', 'good'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('typo'))
      expect(tools.map((t) => t.name)).toEqual(['good-t'])
    } finally {
      warn.mockRestore()
    }
  })

  it('单个 server 连接失败不阻塞其余 server', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ctx = makeCtx({
        configs: [CFG('bad'), CFG('fine')],
        ensureConnectedResults: new Map([['bad', [new Error('spawn fail')]]]),
      })
      const tools = await listToolsForAgent(ctx, 'agent1', ['bad', 'fine'])
      expect(tools.map((t) => t.name)).toEqual(['fine-t'])
    } finally {
      warn.mockRestore()
    }
  })

  it('技能级临时 server 覆盖同名全局 server', async () => {
    const ctx = makeCtx({ configs: [CFG('dup')] })
    const skillServer = CFG('dup')
    const tools = await listToolsForAgent(ctx, 'agent1', ['dup'], [skillServer])
    // 同名全局被移除后仅由技能级 connect 一次
    expect(ctx.clientPool.ensureConnected).toHaveBeenCalledTimes(1)
    expect(tools.map((t) => t.name)).toEqual(['dup-t'])
  })
})

describe('callTool', () => {
  it('已连接 client 直接调用', async () => {
    const ctx = makeCtx({ clients: { s1: { connected: true, tools: [] } } })
    await callTool(ctx, 's1', 't', {})
    expect(ctx.clientPool.callToolInternal).toHaveBeenCalledTimes(1)
    expect(ctx.clientPool.ensureConnected).not.toHaveBeenCalled()
  })

  it('R2-2: client 断开且有配置 → 惰性重连后调用', async () => {
    const ctx = makeCtx({
      configs: [CFG('s1')],
      clients: { s1: { connected: false } },
    })
    await callTool(ctx, 's1', 't', {})
    expect(ctx.clientPool.ensureConnected).toHaveBeenCalledTimes(1)
    expect(ctx.clientPool.callToolInternal).toHaveBeenCalledTimes(1)
  })

  it('断开且无配置 → 抛错', async () => {
    const ctx = makeCtx({ clients: { ghost: { connected: false } } })
    await expect(callTool(ctx, 'ghost', 't', {})).rejects.toThrow(
      'MCP server ghost not connected and no config to reconnect',
    )
  })

  it('重连失败 → 抛出含原因的错误', async () => {
    const ctx = makeCtx({
      configs: [CFG('s1')],
      clients: { s1: { connected: false } },
      ensureConnectedResults: new Map([['s1', [new Error('exit 1')]]]),
    })
    await expect(callTool(ctx, 's1', 't', {})).rejects.toThrow('reconnect failed: exit 1')
  })
})

describe('listTools / testServer', () => {
  it('listTools: 断连返回空,已连返回缓存 tools', async () => {
    const ctx = makeCtx({ clients: { off: { connected: false }, on: { connected: true, tools: [TOOL('t')] } } })
    expect(await listTools(ctx, 'off')).toEqual([])
    expect(await listTools(ctx, 'on')).toHaveLength(1)
  })

  it('testServer: 不存在/成功/异常 三态', async () => {
    const ok = makeCtx({
      configs: [CFG('s1')],
      ensureConnectedResults: new Map([['s1', [{ connected: true, tools: [TOOL('a'), TOOL('b')] }]]]),
    })
    expect(await testServer(ok, 's1')).toEqual({ success: true, toolCount: 2 })

    const missing = makeCtx({ configs: [] })
    expect(await testServer(missing, 'ghost')).toEqual({
      success: false,
      toolCount: 0,
      error: 'Server ghost not found',
    })

    const failing = makeCtx({
      configs: [CFG('s1')],
      ensureConnectedResults: new Map([['s1', [new Error('boom')]]]),
    })
    expect(await testServer(failing, 's1')).toEqual({
      success: false,
      toolCount: 0,
      error: 'boom',
    })
  })
})
