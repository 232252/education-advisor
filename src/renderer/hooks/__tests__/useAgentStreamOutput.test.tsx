// =============================================================
// useAgentStreamOutput — 流式收集与收尾节奏测试
// 锁定 bug 修复: runManual 为「已启动即 resolve」,settle 必须等
// agent 终态(idle/error)才放行,而非固定 1500ms(否则流式输出全部丢失)
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../../stores/agent/store'
import { useAgentStreamOutput } from '../useAgentStreamOutput'

function feed(data: {
  agentId: string
  status: string
  output?: string
  result?: { durationMs: number }
  error?: string
}) {
  act(() => {
    useAgentStore.getState()._handleStatusUpdate(data as never)
  })
}

beforeEach(() => {
  useAgentStore.setState({ _statusListeners: new Set() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgentStreamOutput — 输出收集', () => {
  it('收集 filter 命中的 output 增量,过滤其他 agent', () => {
    const { result } = renderHook(() => useAgentStreamOutput())
    const session = result.current.startSession({ filter: (id) => id === 'main' })
    act(() => {
      session.append('=== 🤖 main ===\n')
      feed({ agentId: 'main', status: 'running', output: '第一段' })
      feed({ agentId: 'other', status: 'running', output: '串扰内容' })
      feed({ agentId: 'main', status: 'running', output: '第二段' })
    })
    expect(result.current.output).toBe('=== 🤖 main ===\n第一段第二段')
    act(() => session.finish())
  })

  it('终态事件追加执行完成分隔行', async () => {
    const { result } = renderHook(() => useAgentStreamOutput())
    const session = result.current.startSession({
      filter: (id) => id === 'main',
      onResult: (ms) => `\n--- 执行完成 (${ms}ms) ---\n`,
    })
    act(() => {
      feed({ agentId: 'main', status: 'idle', result: { durationMs: 1234 } })
    })
    await waitFor(() => expect(result.current.output).toContain('执行完成 (1234ms)'))
    act(() => session.finish())
  })
})

describe('useAgentStreamOutput — settle 收尾节奏', () => {
  it('running 阶段不 resolve,等终态才放行(事件驱动修复)', async () => {
    const { result } = renderHook(() => useAgentStreamOutput())
    const session = result.current.startSession({ filter: (id) => id === 'main' })
    let settled = false
    const done = session.settle().then(() => {
      settled = true
    })
    act(() => {
      feed({ agentId: 'main', status: 'running', output: '流式片段' })
    })
    await vi.waitFor(() => {
      // running 事件之后 settle 仍不得放行
      expect(settled).toBe(false)
    })
    act(() => {
      feed({ agentId: 'main', status: 'idle' })
    })
    await done
    expect(settled).toBe(true)
    act(() => session.finish())
  })

  it('error 终态同样放行', async () => {
    const { result } = renderHook(() => useAgentStreamOutput())
    const session = result.current.startSession({ filter: (id) => id === 'main' })
    const done = session.settle()
    act(() => {
      feed({ agentId: 'main', status: 'error', error: 'boom' })
    })
    await expect(done).resolves.toBeUndefined()
    act(() => session.finish())
  })

  it('终态丢失时按封顶兜底放行', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAgentStreamOutput())
    const session = result.current.startSession({ filter: (id) => id === 'main' })
    const done = session.settle()
    const promiseState = { settled: false }
    done.then(() => {
      promiseState.settled = true
    })
    await vi.advanceTimersByTimeAsync(119_000)
    expect(promiseState.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(promiseState.settled).toBe(true)
    act(() => session.finish())
  })

  it('settle 放行后其观察订阅已退订,不重复放行', async () => {
    const { result } = renderHook(() => useAgentStreamOutput())
    const listenersBefore = useAgentStore.getState()._statusListeners.size
    const session = result.current.startSession({ filter: (id) => id === 'main' })
    const pending = session.settle()
    const duringSettle = useAgentStore.getState()._statusListeners.size
    act(() => {
      feed({ agentId: 'main', status: 'idle' })
    })
    await pending
    const afterIdle = useAgentStore.getState()._statusListeners.size
    act(() => session.finish())
    const after = useAgentStore.getState()._statusListeners.size
    expect(duringSettle).toBe(listenersBefore + 2) // 收集订阅 + settle 观察订阅
    expect(afterIdle).toBe(listenersBefore + 1) // 放行后观察订阅已自行退订
    expect(after).toBe(listenersBefore) // finish 后只剩外部订阅者
  })
})
