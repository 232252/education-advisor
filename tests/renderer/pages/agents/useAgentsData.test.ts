// =============================================================
// useAgentsData — Agent 列表数据 hook 测试
// 覆盖: 挂载自动 fetchAgents / store selector 透传 /
//       加载失败兜底 / 后续手动刷新
// =============================================================

import { createElement, type ReactNode } from 'react'
import { act } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentListItem } from '@shared/types'
import { useAgentsData } from '../../../../src/renderer/pages/Agents/hooks/useAgentsData'
import { useAgentStore } from '../../../../src/renderer/stores/agentStore'

// useAgentsData 使用 useSearchParams(全局搜索 agent_id 跳转),需要 Router 上下文
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(MemoryRouter, { initialEntries: ['/'] }, children)
  }
}

// ---------- window.api mock ----------

const apiMocks = vi.hoisted(() => ({
  agentList: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    agent: { list: apiMocks.agentList },
  }
}

// ---------- 测试数据 ----------

function makeAgent(id: string, enabled: boolean): AgentListItem {
  return {
    id,
    name: `agent-${id}`,
    role: 'r',
    description: 'd',
    enabled,
    modelTier: 'low_cost',
    schedule: [],
    capabilities: [],
    status: 'idle',
  }
}

const agents = [makeAgent('a1', true), makeAgent('a2', false)]

function resetStore() {
  useAgentStore.setState({
    agents: [],
    loading: false,
    selectedAgentId: null,
    selectedDetail: null,
    detailLoading: false,
    _statusListeners: new Set(),
  })
}

describe('useAgentsData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    installApi()
    apiMocks.agentList.mockResolvedValue(agents)
  })

  afterEach(() => {
    resetStore()
    delete (window as unknown as { api?: unknown }).api
  })

  it('挂载即拉取 Agent 列表', async () => {
    const { result } = renderHook(() => useAgentsData(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.agents).toHaveLength(2)
    })
    expect(apiMocks.agentList).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
  })

  it('透传 store 状态: selectedAgentId / detailLoading', async () => {
    const { result } = renderHook(() => useAgentsData(), { wrapper: createWrapper() })
    await waitFor(() => {
      expect(result.current.agents).toHaveLength(2)
    })

    act(() => {
      useAgentStore.setState({ selectedAgentId: 'a1', detailLoading: true })
    })

    expect(result.current.selectedAgentId).toBe('a1')
    expect(result.current.detailLoading).toBe(true)
    expect(result.current.selectedDetail).toBeNull()
  })

  it('返回的 actions 与 store 实现同源', async () => {
    const { result } = renderHook(() => useAgentsData(), { wrapper: createWrapper() })
    await waitFor(() => {
      expect(result.current.agents).toHaveLength(2)
    })

    const state = useAgentStore.getState()
    expect(result.current.fetchAgents).toBe(state.fetchAgents)
    expect(result.current.toggleAgent).toBe(state.toggleAgent)
    expect(result.current.updateAgent).toBe(state.updateAgent)
    expect(result.current.selectAgent).toBe(state.selectAgent)
    expect(result.current.runAgent).toBe(state.runAgent)
    expect(result.current.abortAgent).toBe(state.abortAgent)
    expect(result.current.saveSoul).toBe(state.saveSoul)
    expect(result.current.saveRules).toBe(state.saveRules)
  })

  it('列表加载失败: agents 保持空且 loading 复位', async () => {
    apiMocks.agentList.mockRejectedValue(new Error('no agents'))
    const { result } = renderHook(() => useAgentsData(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.agents).toEqual([])
  })

  it('可通过返回的 fetchAgents 手动刷新', async () => {
    apiMocks.agentList.mockResolvedValueOnce([])
    const { result } = renderHook(() => useAgentsData(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(apiMocks.agentList).toHaveBeenCalledTimes(1)
    })

    // 第二次返回完整列表
    apiMocks.agentList.mockResolvedValueOnce(agents)
    await act(async () => {
      await result.current.fetchAgents()
    })

    expect(apiMocks.agentList).toHaveBeenCalledTimes(2)
    expect(result.current.agents).toEqual(agents)
  })
})