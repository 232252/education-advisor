// =============================================================
// useSchedulerData — Cron 任务/日志/Agent 数据 hook 测试
// 覆盖: allSettled 局部失败兜底 / onStatusUpdate 订阅刷新 /
//       handleToggle / handleRunNow(2s 定时刷新) / handleRemove /
//       handleCreate / handleEdit 成败分支
// =============================================================

import { act } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentListItem, CronLogEntry, CronTask } from '@shared/types'
import { useSchedulerData } from '../../../../src/renderer/pages/Scheduler/hooks/useSchedulerData'

// ---------- toast mock ----------

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    warning: toastMocks.warning,
    info: toastMocks.info,
    show: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}))

// ---------- window.api mock ----------

const apiMocks = vi.hoisted(() => ({
  cronList: vi.fn(),
  getLogs: vi.fn(),
  agentList: vi.fn(),
  cronToggle: vi.fn(),
  runNow: vi.fn(),
  cronRemove: vi.fn(),
  cronAdd: vi.fn(),
  cronUpdate: vi.fn(),
  onStatusUpdate: vi.fn(),
}))

let statusCallback: ((data: unknown) => void) | null = null
let unsubSpy: ReturnType<typeof vi.fn>

function installApi() {
  statusCallback = null
  unsubSpy = vi.fn()
  apiMocks.onStatusUpdate.mockImplementation((cb: (data: unknown) => void) => {
    statusCallback = cb
    return unsubSpy
  })
  ;(window as unknown as { api: unknown }).api = {
    cron: {
      list: apiMocks.cronList,
      add: apiMocks.cronAdd,
      update: apiMocks.cronUpdate,
      remove: apiMocks.cronRemove,
      toggle: apiMocks.cronToggle,
      runNow: apiMocks.runNow,
      getLogs: apiMocks.getLogs,
      onStatusUpdate: apiMocks.onStatusUpdate,
    },
    agent: { list: apiMocks.agentList },
  }
}

// ---------- 测试数据 ----------

const tasks: CronTask[] = [
  {
    id: 't1',
    name: '每日总结',
    agentId: 'a1',
    expression: '0 8 * * *',
    prompt: 'p',
    enabled: true,
    modelTier: 'low_cost',
  },
]

const logs: CronLogEntry[] = [
  { taskId: 't1', agentId: 'a1', timestamp: 1, durationMs: 12, status: 'success' },
]

const agents: AgentListItem[] = [
  {
    id: 'a1',
    name: 'agent-1',
    role: 'r',
    description: 'd',
    enabled: true,
    modelTier: 'low_cost',
    schedule: [],
    capabilities: [],
    status: 'idle',
  },
]

describe('useSchedulerData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    apiMocks.cronList.mockResolvedValue(tasks)
    apiMocks.getLogs.mockResolvedValue(logs)
    apiMocks.agentList.mockResolvedValue(agents)
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  // ---------- 数据加载 ----------

  it('挂载后并行加载任务/日志/Agent, loading 复位', async () => {
    const { result } = renderHook(() => useSchedulerData())
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tasks).toEqual(tasks)
    expect(result.current.logs).toEqual(logs)
    expect(result.current.agents).toEqual(agents)
    expect(apiMocks.cronList).toHaveBeenCalledTimes(1)
  })

  it('单个 IPC 失败不阻塞其他数据(allSettled 兜底为 [])', async () => {
    apiMocks.agentList.mockRejectedValue(new Error('agent down'))
    const { result } = renderHook(() => useSchedulerData())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tasks).toEqual(tasks)
    expect(result.current.logs).toEqual(logs)
    expect(result.current.agents).toEqual([])
  })

  it('订阅 cron 状态事件, 事件到达后重新加载', async () => {
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(statusCallback).not.toBeNull()
    const before = apiMocks.cronList.mock.calls.length
    await act(async () => {
      statusCallback?.({ status: 'success' })
    })

    await waitFor(() => {
      expect(apiMocks.cronList.mock.calls.length).toBe(before + 1)
    })
  })

  it('卸载时取消状态订阅', async () => {
    const { result, unmount } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    unmount()
    expect(unsubSpy).toHaveBeenCalledTimes(1)
  })

  // ---------- handleToggle ----------

  it('handleToggle 成功: 调用 IPC 并刷新', async () => {
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    const before = apiMocks.cronList.mock.calls.length

    await act(async () => {
      await result.current.handleToggle('t1', false)
    })

    expect(apiMocks.cronToggle).toHaveBeenCalledWith('t1', false)
    await waitFor(() => {
      expect(apiMocks.cronList.mock.calls.length).toBe(before + 1)
    })
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('handleToggle 失败: error toast', async () => {
    apiMocks.cronToggle.mockRejectedValue(new Error('busy'))
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.handleToggle('t1', true)
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  // ---------- handleRunNow ----------

  it('handleRunNow: 成功后延迟 2 秒自动刷新', async () => {
    vi.useFakeTimers()
    try {
      apiMocks.runNow.mockResolvedValue({ success: true })
      const { result } = renderHook(() => useSchedulerData())
      await act(async () => {})

      const before = apiMocks.cronList.mock.calls.length
      await act(async () => {
        await result.current.handleRunNow('t1')
      })
      // 定时器未到: 不刷新
      expect(apiMocks.cronList.mock.calls.length).toBe(before)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(apiMocks.cronList.mock.calls.length).toBe(before + 1)
      expect(toastMocks.error).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('handleRunNow 失败: error toast', async () => {
    apiMocks.runNow.mockRejectedValue(new Error('queue full'))
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.handleRunNow('t1')
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  // ---------- handleRemove ----------

  it('handleRemove: 打开 danger 确认框, 确认后删除并刷新', async () => {
    apiMocks.cronRemove.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    const before = apiMocks.cronList.mock.calls.length

    act(() => {
      result.current.handleRemove('t1')
    })
    expect(result.current.confirmState.open).toBe(true)
    expect(result.current.confirmState.variant).toBe('danger')

    await act(async () => {
      await result.current.confirmState.onConfirm()
    })

    expect(apiMocks.cronRemove).toHaveBeenCalledWith('t1')
    expect(result.current.confirmState.open).toBe(false)
    await waitFor(() => {
      expect(apiMocks.cronList.mock.calls.length).toBe(before + 1)
    })
  })

  it('handleRemove 删除失败: error toast 且确认框关闭', async () => {
    apiMocks.cronRemove.mockRejectedValue(new Error('deny'))
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.handleRemove('t1')
    })
    await act(async () => {
      await result.current.confirmState.onConfirm()
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(result.current.confirmState.open).toBe(false)
  })

  // ---------- handleCreate ----------

  it('handleCreate 成功: 返回 true 并刷新', async () => {
    apiMocks.cronAdd.mockResolvedValue('t2')
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    const before = apiMocks.cronList.mock.calls.length

    let ok = false
    await act(async () => {
      ok = await result.current.handleCreate({
        name: '新任务',
        agentId: 'a1',
        expression: '0 9 * * *',
        prompt: 'p',
        enabled: true,
        modelTier: 'low_cost',
      })
    })

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(apiMocks.cronList.mock.calls.length).toBe(before + 1)
    })
  })

  it('handleCreate 失败: 返回 false 并 error toast', async () => {
    apiMocks.cronAdd.mockRejectedValue(new Error('invalid'))
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let ok = true
    await act(async () => {
      ok = await result.current.handleCreate({
        name: 'x',
        agentId: 'a1',
        expression: 'bad',
        prompt: 'p',
        enabled: true,
        modelTier: 'low_cost',
      })
    })

    expect(ok).toBe(false)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  // ---------- handleEdit ----------

  it('handleEdit 成功: 返回 true + success toast + 刷新', async () => {
    apiMocks.cronUpdate.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    const before = apiMocks.cronList.mock.calls.length

    let ok = false
    await act(async () => {
      ok = await result.current.handleEdit('t1', { enabled: false })
    })

    expect(apiMocks.cronUpdate).toHaveBeenCalledWith('t1', { enabled: false })
    expect(ok).toBe(true)
    expect(toastMocks.success).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(apiMocks.cronList.mock.calls.length).toBe(before + 1)
    })
  })

  it('handleEdit res.success=false: 返回 false + error toast', async () => {
    apiMocks.cronUpdate.mockResolvedValue({ success: false })
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let ok = true
    await act(async () => {
      ok = await result.current.handleEdit('t1', { name: 'x' })
    })

    expect(ok).toBe(false)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(toastMocks.success).not.toHaveBeenCalled()
  })

  it('handleEdit 抛错: 返回 false + error toast', async () => {
    apiMocks.cronUpdate.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSchedulerData())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let ok = true
    await act(async () => {
      ok = await result.current.handleEdit('t1', { name: 'x' })
    })

    expect(ok).toBe(false)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })
})