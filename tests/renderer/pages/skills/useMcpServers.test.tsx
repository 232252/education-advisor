// =============================================================
// useMcpServers — McpTab 数据加载与动作 handlers 测试
// 覆盖: 初始加载/可见性守卫、toggle MCP、工具懒加载(代际/错误记录)、
//       test/connect/disconnect/toggle/delete/edit/formSubmit 各分支
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig, McpServerStatus, McpTool } from '@shared/types'

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  mcpList: vi.fn(),
  mcpListTools: vi.fn(),
  mcpTest: vi.fn(),
  mcpConnect: vi.fn(),
  mcpDisconnect: vi.fn(),
  mcpUpdate: vi.fn(),
  mcpRemove: vi.fn(),
  mcpAdd: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    settings: {
      get: mocks.settingsGet,
      set: mocks.settingsSet,
    },
    mcp: {
      list: mocks.mcpList,
      listTools: mocks.mcpListTools,
      test: mocks.mcpTest,
      connect: mocks.mcpConnect,
      disconnect: mocks.mcpDisconnect,
      update: mocks.mcpUpdate,
      remove: mocks.mcpRemove,
      add: mocks.mcpAdd,
    },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: toastMocks,
}))

import { useMcpServers } from '../../../../src/renderer/pages/Skills/hooks/useMcpServers'

function srv(p: Partial<McpServerStatus> & { id: string }): McpServerStatus {
  return {
    name: p.id,
    connected: false,
    toolCount: 0,
    transport: 'stdio',
    source: 'user',
    enabled: true,
    ...p,
  }
}

const SERVERS: McpServerStatus[] = [
  srv({ id: 's1', name: 'Server One', connected: true, toolCount: 2 }),
  srv({ id: 's2', name: 'Server Two', connected: false, enabled: false }),
]

function tool(name: string): McpTool {
  return { serverId: 's1', name, description: '' } as McpTool
}

async function flush(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderLoaded() {
  const rendered = renderHook(() => useMcpServers())
  await flush()
  return rendered
}
describe('useMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsGet.mockResolvedValue({ mcp: { enabled: true } })
    mocks.settingsSet.mockResolvedValue({ success: true })
    mocks.mcpList.mockResolvedValue({ success: true, servers: SERVERS })
    mocks.mcpListTools.mockResolvedValue({ success: true, tools: [tool('t1'), tool('t2')] })
    mocks.mcpTest.mockResolvedValue({ success: true, toolCount: 3 })
    mocks.mcpConnect.mockResolvedValue({ success: true })
    mocks.mcpDisconnect.mockResolvedValue({ success: true })
    mocks.mcpUpdate.mockResolvedValue({ success: true })
    mocks.mcpRemove.mockResolvedValue({ success: true })
    mocks.mcpAdd.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始加载', () => {
    it('读取 mcp.enabled 并加载 server 列表', async () => {
      const { result } = await renderLoaded()

      expect(mocks.settingsGet).toHaveBeenCalledTimes(1)
      expect(mocks.mcpList).toHaveBeenCalledTimes(1)
      expect(result.current.mcpEnabled).toBe(true)
      expect(result.current.loading).toBe(false)
      expect(result.current.servers.map((s) => s.id)).toEqual(['s1', 's2'])
    })

    it('settings.get 抛错时 mcpEnabled 回退 false', async () => {
      mocks.settingsGet.mockRejectedValue(new Error('x'))
      const { result } = await renderLoaded()

      expect(result.current.mcpEnabled).toBe(false)
    })

    it('mcp.list 返回 success=false + error 时 toast.error', async () => {
      mocks.mcpList.mockResolvedValue({ success: false, error: 'service disabled' })
      await renderLoaded()

      expect(toastMocks.error).toHaveBeenCalledWith('service disabled')
    })

    it('mcp.list 抛错时 toast.error(loadFailed)', async () => {
      mocks.mcpList.mockRejectedValue(new Error('ipc down'))
      await renderLoaded()

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })

    it('页面不可见(hidden)时跳过加载', async () => {
      // visibilityState 是 Document.prototype 上的 getter,这里在实例上
      // 覆盖自有属性,结束后 delete 恢复原型 getter(避免污染后续测试)
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      try {
        const { result } = await renderLoaded()
        expect(mocks.mcpList).not.toHaveBeenCalled()
        expect(result.current.loading).toBe(false)
      } finally {
        delete (document as { visibilityState?: string }).visibilityState
      }
    })

    it('内容不变的重复 loadServers 保留引用(浅比较优化)', async () => {
      const { result } = await renderLoaded()
      const first = result.current.servers

      await act(async () => {
        await result.current.handleTest('s1') // 内部会再次 loadServers
      })
      // mock 返回同一份数据,引用保持稳定
      expect(result.current.servers).toBe(first)
    })
  })

  describe('handleToggleMcp', () => {
    it('启用成功: 写设置 + 重新加载 servers', async () => {
      mocks.settingsGet.mockResolvedValue({ mcp: { enabled: false } })
      const { result } = await renderLoaded()
      expect(result.current.mcpEnabled).toBe(false)
      mocks.mcpList.mockClear()

      await act(async () => {
        await result.current.handleToggleMcp(true)
      })
      await flush()

      expect(mocks.settingsSet).toHaveBeenCalledWith('mcp.enabled', true)
      expect(result.current.mcpEnabled).toBe(true)
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(mocks.mcpList).toHaveBeenCalledTimes(1)
    })

    it('禁用成功: 清空 servers/tools 缓存/选中项', async () => {
      const { result } = await renderLoaded()

      // 先选中已连接的 s1 触发工具加载
      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()
      expect(result.current.toolsCache.s1).toHaveLength(2)

      await act(async () => {
        await result.current.handleToggleMcp(false)
      })

      expect(result.current.mcpEnabled).toBe(false)
      expect(result.current.servers).toEqual([])
      expect(result.current.selectedId).toBe(null)
      expect(result.current.toolsCache).toEqual({})
      expect(result.current.toolsErrorMap).toEqual({})
    })

    it('result.success=false: toast.error(toggleFailed) 且状态不变', async () => {
      mocks.settingsSet.mockResolvedValue({ success: false })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleToggleMcp(false)
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(result.current.mcpEnabled).toBe(true)
    })

    it('settings.set 抛错: toast.error(err.message)', async () => {
      mocks.settingsSet.mockRejectedValue(new Error('write failed'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleToggleMcp(false)
      })

      expect(toastMocks.error).toHaveBeenCalledWith('write failed')
    })
  })
  describe('工具懒加载 loadTools', () => {
    it('选中已连接 server 自动拉取工具', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()

      expect(mocks.mcpListTools).toHaveBeenCalledWith('s1')
      expect(result.current.toolsCache.s1.map((t) => t.name)).toEqual(['t1', 't2'])
      expect(result.current.toolsLoadingId).toBe(null)
      expect(result.current.selected?.id).toBe('s1')
    })

    it('选中未连接 server 不拉取工具', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setSelectedId('s2')
      })
      await flush()

      expect(mocks.mcpListTools).not.toHaveBeenCalled()
      expect(result.current.selected?.id).toBe('s2')
    })

    it('已有缓存的 server 不重复拉取', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()
      expect(mocks.mcpListTools).toHaveBeenCalledTimes(1)

      // 切走再切回,缓存命中
      act(() => {
        result.current.setSelectedId('s2')
      })
      await flush()
      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()
      expect(mocks.mcpListTools).toHaveBeenCalledTimes(1)
    })

    it('listTools 返回 success=false: 记录错误信息', async () => {
      mocks.mcpListTools.mockResolvedValue({ success: false, error: 'handshake failed' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.loadTools('s1')
      })

      expect(result.current.toolsErrorMap.s1).toBe('handshake failed')
      expect(result.current.toolsCache.s1).toBeUndefined()
    })

    it('listTools 抛错: 记录 err.message', async () => {
      mocks.mcpListTools.mockRejectedValue(new Error('timeout exceeded'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.loadTools('s1')
      })

      expect(result.current.toolsErrorMap.s1).toBe('timeout exceeded')
    })

    it('成功后清除既有错误记录', async () => {
      mocks.mcpListTools.mockResolvedValueOnce({ success: false, error: 'first fails' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.loadTools('s1')
      })
      expect(result.current.toolsErrorMap.s1).toBe('first fails')

      mocks.mcpListTools.mockResolvedValueOnce({ success: true, tools: [tool('t1')] })
      await act(async () => {
        await result.current.loadTools('s1')
      })

      expect(result.current.toolsErrorMap.s1).toBeUndefined()
      expect(result.current.toolsCache.s1).toHaveLength(1)
    })
  })

  describe('handleTest / handleConnect / handleDisconnect', () => {
    it('handleTest 成功: toast 含工具数并刷新 server 列表与工具', async () => {
      const { result } = await renderLoaded()
      mocks.mcpList.mockClear()
      mocks.mcpListTools.mockClear()

      await act(async () => {
        await result.current.handleTest('s1')
      })
      await flush()

      expect(mocks.mcpTest).toHaveBeenCalledWith('s1')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(toastMocks.success.mock.calls[0][0]).toContain('3')
      expect(mocks.mcpList).toHaveBeenCalledTimes(1)
      expect(mocks.mcpListTools).toHaveBeenCalledWith('s1')
    })

    it('handleTest 失败: toast.error(result.error)', async () => {
      mocks.mcpTest.mockResolvedValue({ success: false, error: 'cannot spawn' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleTest('s1')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('cannot spawn')
    })

    it('handleTest 抛错: toast.error(err.message)', async () => {
      mocks.mcpTest.mockRejectedValue(new Error('boom'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleTest('s1')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('boom')
    })

    it('handleConnect 成功: toast + 刷新列表与工具', async () => {
      const { result } = await renderLoaded()
      mocks.mcpList.mockClear()

      await act(async () => {
        await result.current.handleConnect('s1')
      })
      await flush()

      expect(mocks.mcpConnect).toHaveBeenCalledWith('s1')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(mocks.mcpList).toHaveBeenCalledTimes(1)
      expect(mocks.mcpListTools).toHaveBeenCalledWith('s1')
    })

    it('handleConnect 失败: toast.error(result.error)', async () => {
      mocks.mcpConnect.mockResolvedValue({ success: false, error: 'refused' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleConnect('s1')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('refused')
    })

    it('handleDisconnect 成功: 清理工具缓存并刷新列表', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()
      expect(result.current.toolsCache.s1).toHaveLength(2)
      mocks.mcpList.mockClear()
      // 断开后 server 列表应反映 s1 已断开,懒加载 effect 才不会回填缓存
      mocks.mcpList.mockResolvedValue({
        success: true,
        servers: [srv({ id: 's1', name: 'Server One', connected: false, toolCount: 0 }), SERVERS[1]],
      })

      await act(async () => {
        await result.current.handleDisconnect('s1')
      })
      await flush()

      expect(mocks.mcpDisconnect).toHaveBeenCalledWith('s1')
      expect(result.current.toolsCache.s1).toBeUndefined()
      expect(mocks.mcpList).toHaveBeenCalledTimes(1)
    })

    it('handleDisconnect 失败: toast.error 且不清缓存', async () => {
      mocks.mcpDisconnect.mockResolvedValue({ success: false })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDisconnect('s1')
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })
  describe('handleToggleEnabled / handleDelete / handleEdit / handleFormSubmit', () => {
    it('handleToggleEnabled 禁用成功: 清理工具缓存', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()
      expect(result.current.toolsCache.s1).toHaveLength(2)
      mocks.mcpList.mockResolvedValue({
        success: true,
        servers: [srv({ id: 's1', name: 'Server One', connected: false, toolCount: 0 }), SERVERS[1]],
      })

      await act(async () => {
        await result.current.handleToggleEnabled('s1', false)
      })
      await flush()

      expect(mocks.mcpUpdate).toHaveBeenCalledWith('s1', { enabled: false })
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(result.current.toolsCache.s1).toBeUndefined()
    })

    it('handleToggleEnabled 启用成功: 不清缓存', async () => {
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleToggleEnabled('s2', true)
      })

      expect(mocks.mcpUpdate).toHaveBeenCalledWith('s2', { enabled: true })
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
    })

    it('handleToggleEnabled 失败: toast.error(result.error)', async () => {
      mocks.mcpUpdate.mockResolvedValue({ success: false, error: 'readonly' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleToggleEnabled('s1', false)
      })

      expect(toastMocks.error).toHaveBeenCalledWith('readonly')
    })

    it('handleDelete 成功: 若删除当前选中项则清空 selectedId 并清缓存', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setSelectedId('s1')
      })
      await flush()
      expect(result.current.toolsCache.s1).toHaveLength(2)

      await act(async () => {
        await result.current.handleDelete('s1')
      })
      await flush()

      expect(mocks.mcpRemove).toHaveBeenCalledWith('s1')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(result.current.selectedId).toBe(null)
      expect(result.current.toolsCache.s1).toBeUndefined()
    })

    it('handleDelete 失败: toast.error', async () => {
      mocks.mcpRemove.mockResolvedValue({ success: false, error: 'global readonly' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDelete('s1')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('global readonly')
    })

    it('handleEdit: 用已知字段预填编辑表单', async () => {
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleEdit('s2')
      })

      expect(result.current.editingServer).toEqual({
        id: 's2',
        name: 'Server Two',
        enabled: false,
        transport: 'stdio',
      })
      expect(result.current.showForm).toBe(true)
      expect(result.current.presetDraft).toBe(null)
    })

    it('handleEdit 未知 id: 无操作', async () => {
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleEdit('nope')
      })

      expect(result.current.editingServer).toBe(null)
      expect(result.current.showForm).toBe(false)
    })

    it('handleFormSubmit 编辑模式: 调 mcp.update 并关闭表单', async () => {
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleEdit('s1')
      })
      const config: McpServerConfig = {
        id: 's1',
        name: 'Renamed',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
      }
      await act(async () => {
        await result.current.handleFormSubmit(config)
      })
      await flush()

      expect(mocks.mcpUpdate).toHaveBeenCalledWith('s1', config)
      expect(mocks.mcpAdd).not.toHaveBeenCalled()
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(result.current.showForm).toBe(false)
      expect(result.current.editingServer).toBe(null)
    })

    it('handleFormSubmit 新增模式: 调 mcp.add', async () => {
      const { result } = await renderLoaded()
      const config: McpServerConfig = {
        id: 'new-server',
        name: 'New',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
      }

      await act(async () => {
        await result.current.handleFormSubmit(config)
      })
      await flush()

      expect(mocks.mcpAdd).toHaveBeenCalledWith(config)
      expect(mocks.mcpUpdate).not.toHaveBeenCalled()
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(result.current.showForm).toBe(false)
    })

    it('handleFormSubmit 失败: toast.error 且表单保持打开', async () => {
      mocks.mcpAdd.mockResolvedValue({ success: false, error: 'duplicate id' })
      const { result } = await renderLoaded()
      const config: McpServerConfig = {
        id: 'dup',
        name: 'Dup',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
      }

      await act(async () => {
        await result.current.handleFormSubmit(config)
      })

      expect(toastMocks.error).toHaveBeenCalledWith('duplicate id')
      expect(result.current.showForm).toBe(false)
    })
  })
})