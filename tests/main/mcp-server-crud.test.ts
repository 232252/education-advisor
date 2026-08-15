// =============================================================
// mcp-management/server-crud — server 查询/更新/删除测试
// 覆盖: listServers 状态映射、updateServer(校验/断开/用户级覆盖/净化)、
//       removeServer(只读全局/纯用户/覆盖恢复)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@shared/types'
import type { McpServiceContext } from '../../src/main/services/mcp-management/context'

import { addServer, listServers, removeServer, updateServer } from '../../src/main/services/mcp-management/server-crud'

function cfg(p: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv1',
    name: 'S1',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'x'],
    ...p,
  }
}

interface CtxHarness {
  ctx: McpServiceContext
  /** 最近一次 writeUserConfig 收到的列表 */
  written: McpServerConfig[][]
  userServers: McpServerConfig[]
  globalServers: McpServerConfig[]
  disconnectClient: ReturnType<typeof vi.fn>
  deleteClientEntry: ReturnType<typeof vi.fn>
  serializeWrite: ReturnType<typeof vi.fn>
}

function makeCtx(
  configList: McpServerConfig[],
  userServers: McpServerConfig[],
  globalServers: McpServerConfig[] = [],
): CtxHarness {
  const harness: CtxHarness = {
    written: [],
    userServers: [...userServers],
    globalServers,
    disconnectClient: vi.fn(async () => {}),
    deleteClientEntry: vi.fn(),
    serializeWrite: vi.fn((fn: () => Promise<unknown>) => fn()),
    ctx: null as unknown as McpServiceContext,
  }
  harness.ctx = {
    configStore: {
      configList,
      readUserConfig: vi.fn(async () => [...harness.userServers]),
      writeUserConfig: vi.fn(async (servers: McpServerConfig[]) => {
        harness.written.push(servers)
        harness.userServers = [...servers]
      }),
      serializeWrite: harness.serializeWrite,
      loadConfigFile: vi.fn(async () => [...harness.globalServers]),
      addServer: vi.fn(async () => {}),
    },
    clientPool: {
      clientsMap: new Map(),
      connectingMap: new Map(),
      disconnectClient: harness.disconnectClient,
      deleteClientEntry: harness.deleteClientEntry,
    },
    configPath: '/fake/config/mcp.yaml',
    initialized: true,
  } as unknown as McpServiceContext
  return harness
}

/** 伪 MCPClient(带 pending/tools) */
function fakeClient() {
  return {
    serverId: 'srv1',
    config: cfg(),
    connected: true,
    tools: [{ serverId: 'srv1', name: 't1' }, { serverId: 'srv1', name: 't2' }],
    requestId: 1,
    pending: new Map(),
  }
}
describe('listServers', () => {
  it('空配置返回空数组', () => {
    const { ctx } = makeCtx([], [])
    expect(listServers(ctx)).toEqual([])
  })

  it('合并 client 状态: connected/toolCount/lastError', () => {
    const client = fakeClient()
    client.lastError = 'boom'
    const { ctx } = makeCtx([cfg()], [])
    ctx.clientPool.clientsMap.set('srv1', client as never)

    const [s] = listServers(ctx)
    expect(s).toMatchObject({
      id: 'srv1',
      name: 'S1',
      connected: true,
      toolCount: 2,
      lastError: 'boom',
      transport: 'stdio',
      source: 'global',
      enabled: true,
    })
  })

  it('无 client 的 server: connected=false, toolCount=0, lastError undefined; source 缺省 global', () => {
    const { ctx } = makeCtx([cfg({ id: 'x', source: undefined })], [])
    const [s] = listServers(ctx)
    expect(s.connected).toBe(false)
    expect(s.toolCount).toBe(0)
    expect(s.lastError).toBeUndefined()
    expect(s.source).toBe('global')
  })
})

describe('addServer', () => {
  it('委托 configStore.addServer', async () => {
    const { ctx } = makeCtx([], [])
    const config = cfg({ id: 'new' })
    await addServer(ctx, config)
    expect(ctx.configStore.addServer).toHaveBeenCalledWith(config)
  })
})

describe('updateServer', () => {
  it('不存在的 id 抛错', async () => {
    const { ctx } = makeCtx([], [])
    await expect(updateServer(ctx, 'nope', {})).rejects.toThrow(/Server nope not found/)
  })

  it('patch.command 不安全时抛错', async () => {
    const { ctx } = makeCtx([cfg()], [])
    await expect(updateServer(ctx, 'srv1', { command: 'sh; rm -rf /' })).rejects.toThrow(
      /command failed safety check/,
    )
  })

  it('patch.url 未过 SSRF 校验时抛错', async () => {
    const { ctx } = makeCtx([cfg()], [])
    await expect(
      updateServer(ctx, 'srv1', { transport: 'sse', url: 'http://169.254.169.254/x' }),
    ).rejects.toThrow(/url failed SSRF check/)
  })

  it('transport 改为非 stdio 且 existing.url 危险时抛错', async () => {
    const { ctx } = makeCtx([cfg({ transport: 'stdio', url: 'http://10.0.0.9/sse' })], [])
    await expect(updateServer(ctx, 'srv1', { transport: 'sse' })).rejects.toThrow(
      /url failed SSRF check/,
    )
  })

  it('用户级 server: patch 写入 user 配置并同步内存(source=user)', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, written } = makeCtx([existing], [existing])

    await updateServer(ctx, 'srv1', { name: 'Renamed', enabled: false })

    expect(written).toHaveLength(1)
    expect(written[0][0]).toMatchObject({ id: 'srv1', name: 'Renamed', enabled: false, source: 'user' })
    expect(ctx.configStore.configList[0]).toMatchObject({ name: 'Renamed', enabled: false, source: 'user' })
    expect(ctx.configStore.writeUserConfig).toHaveBeenCalledTimes(1)
  })

  it('内存为 user 但文件缺失: 追加到 user 文件', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, written } = makeCtx([existing], [])

    await updateServer(ctx, 'srv1', { name: 'Rebuilt' })

    expect(written[0]).toHaveLength(1)
    expect(written[0][0]).toMatchObject({ id: 'srv1', name: 'Rebuilt', source: 'user' })
  })

  it('全局项首次覆盖: 复制到 user 并标记 overrides=global', async () => {
    const existing = cfg({ source: 'global' })
    const { ctx, written } = makeCtx([existing], [])

    await updateServer(ctx, 'srv1', { name: 'Overridden' })

    expect(written[0][0]).toMatchObject({ id: 'srv1', name: 'Overridden', source: 'user', overrides: 'global' })
    expect(ctx.configStore.configList[0]).toMatchObject({ source: 'user' })
  })

  it('已连接的 server 先等待 inflight 并断开清理', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, disconnectClient, deleteClientEntry } = makeCtx([existing], [existing])
    const client = fakeClient()
    ctx.clientPool.clientsMap.set('srv1', client as never)
    ctx.clientPool.connectingMap.set('srv1', Promise.reject(new Error('still connecting')))

    await updateServer(ctx, 'srv1', { name: 'X' })

    expect(disconnectClient).toHaveBeenCalledWith(client)
    expect(deleteClientEntry).toHaveBeenCalledWith('srv1')
  })

  it('patch 中的原型污染 key 被净化', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, written } = makeCtx([existing], [existing])
    const patch = { name: 'Safe', ['__proto__']: { polluted: true } } as unknown as Partial<McpServerConfig>

    await updateServer(ctx, 'srv1', patch)

    const json = JSON.stringify(written[0][0])
    expect(json).not.toContain('polluted')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('操作经 serializeWrite 队列串行执行', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, serializeWrite } = makeCtx([existing], [existing])

    await updateServer(ctx, 'srv1', { name: 'X' })

    expect(serializeWrite).toHaveBeenCalledTimes(1)
  })
})
describe('removeServer', () => {
  it('不存在的 id 抛错', async () => {
    const { ctx } = makeCtx([], [])
    await expect(removeServer(ctx, 'nope')).rejects.toThrow(/Server nope not found/)
  })

  it('纯全局项(不在 user yaml)只读,拒绝删除', async () => {
    const existing = cfg({ source: 'global' })
    const { ctx } = makeCtx([existing], [])

    await expect(removeServer(ctx, 'srv1')).rejects.toThrow(
      /Server srv1 is global \(read-only\), cannot remove/,
    )
  })

  it('纯用户级: 从 user 文件与内存中删除', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, written } = makeCtx([existing, cfg({ id: 'other' })], [existing])

    await removeServer(ctx, 'srv1')

    expect(written).toHaveLength(1)
    expect(written[0].map((s) => s.id)).toEqual([])
    expect(ctx.configStore.configList.map((s) => s.id)).toEqual(['other'])
  })

  it('覆盖全局产生的用户级: 删除后恢复全局默认', async () => {
    const override = cfg({ source: 'user', overrides: 'global', name: 'MyOverride' })
    const globalEntry = cfg({ source: 'global', name: 'OriginalGlobal' })
    const { ctx } = makeCtx([override], [override], [globalEntry])

    await removeServer(ctx, 'srv1')

    // 内存恢复为全局项
    expect(ctx.configStore.configList[0]).toMatchObject({ id: 'srv1', name: 'OriginalGlobal', source: 'global' })
    // user 文件中该项已删除
    expect(ctx.configStore.configList).toHaveLength(1)
  })

  it('overrides=global 但全局文件已无该项: 从内存移除', async () => {
    const override = cfg({ source: 'user', overrides: 'global' })
    const { ctx } = makeCtx([override], [override], [])

    await removeServer(ctx, 'srv1')

    expect(ctx.configStore.configList).toHaveLength(0)
  })

  it('删除已连接 server: 先断开清理 client', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, disconnectClient, deleteClientEntry } = makeCtx([existing], [existing])
    const client = fakeClient()
    ctx.clientPool.clientsMap.set('srv1', client as never)

    await removeServer(ctx, 'srv1')

    expect(disconnectClient).toHaveBeenCalledWith(client)
    expect(deleteClientEntry).toHaveBeenCalledWith('srv1')
  })

  it('操作经 serializeWrite 队列串行执行', async () => {
    const existing = cfg({ source: 'user' })
    const { ctx, serializeWrite } = makeCtx([existing], [existing])

    await removeServer(ctx, 'srv1')
    expect(serializeWrite).toHaveBeenCalledTimes(1)
  })
})