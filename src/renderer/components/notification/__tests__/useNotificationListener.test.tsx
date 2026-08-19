// =============================================================
// useNotificationListener — 事件→通知转换测试
// 验证: agent 状态事件(error/aborted/result)与 cron 状态事件
//       (error/skipped_circuit_breaker/飞书 success)被转为对应通知
// =============================================================

import type { AgentStatusPayload, CronTask } from '@shared/types'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../../../stores/agentStore'
import { useNotificationStore } from '../../../stores/notificationStore'
import { _resetCronNameCacheForTest, useNotificationListener } from '../useNotificationListener'

// cron 状态回调捕获器 — window.api.cron.onStatusUpdate 拿到回调后手动触发
let cronCallback: ((raw: unknown) => void) | null = null
const cronListMock = vi.fn<() => Promise<CronTask[]>>()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useNotificationStore.getState().clear()
  _resetCronNameCacheForTest()
  cronCallback = null
  cronListMock.mockResolvedValue([])
  ;(window as unknown as { api: unknown }).api = {
    cron: {
      list: cronListMock,
      onStatusUpdate: (cb: (raw: unknown) => void) => {
        cronCallback = cb
        return () => {
          cronCallback = null
        }
      },
    },
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

/** 探针组件 — 挂载 listener hook */
function Probe() {
  useNotificationListener()
  return null
}

/** 触发 agent 状态事件: 直接调真实 agentStore 的派生总线入口 */
function emitAgentEvent(payload: AgentStatusPayload) {
  useAgentStore.getState()._handleStatusUpdate(payload)
}

describe('useNotificationListener — agent 事件', () => {
  it('running 状态不产生通知', () => {
    render(<Probe />)
    emitAgentEvent({ agentId: 'a1', status: 'running' })
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('error 状态 → 错误通知,含 agent 名与错误信息', () => {
    useAgentStore.setState({
      agents: [
        {
          id: 'a1',
          name: '学情分析',
          role: '',
          description: '',
          enabled: true,
          modelTier: 'high_quality',
          schedule: [],
          capabilities: [],
          status: 'idle',
        },
      ],
    })
    render(<Probe />)
    emitAgentEvent({ agentId: 'a1', status: 'error', error: 'API 超时' })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('agent')
    expect(items[0].level).toBe('error')
    expect(items[0].title).toContain('学情分析')
    expect(items[0].message).toBe('API 超时')
    expect(items[0].target).toBe('/agents?agent_id=a1')
  })

  it('idle + aborted → 中止通知(info)', () => {
    render(<Probe />)
    emitAgentEvent({ agentId: 'a1', status: 'idle', aborted: true })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].level).toBe('info')
    expect(items[0].title).toContain('中止')
  })

  it('idle + result(success) → 成功通知,含输出摘要', () => {
    render(<Probe />)
    emitAgentEvent({
      agentId: 'a1',
      status: 'idle',
      result: {
        id: 'e1',
        agentId: 'a1',
        prompt: 'p',
        output: '分析完成,共 45 名学生成绩已汇总。',
        startedAt: Date.now(),
        durationMs: 1000,
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: 0,
        status: 'success',
      },
    })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].level).toBe('success')
    expect(items[0].message).toContain('45 名学生')
  })

  it('idle + result(error) → 错误通知', () => {
    render(<Probe />)
    emitAgentEvent({
      agentId: 'a1',
      status: 'idle',
      result: {
        id: 'e1',
        agentId: 'a1',
        prompt: 'p',
        output: '',
        startedAt: Date.now(),
        durationMs: 1000,
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: 0,
        status: 'error',
      },
    })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].level).toBe('error')
  })

  it('idle 无 result 无 aborted → 不通知', () => {
    render(<Probe />)
    emitAgentEvent({ agentId: 'a1', status: 'idle' })
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('未挂载 listener 时事件不产生通知', () => {
    emitAgentEvent({ agentId: 'a1', status: 'error', error: 'x' })
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })
})

describe('useNotificationListener — cron 事件', () => {
  it('error 状态 → 错误通知,任务名从 cron.list 解析', async () => {
    cronListMock.mockResolvedValue([
      { id: 't1', name: '每日学情汇总', agentId: 'a1', schedule: '0 8 * * *', enabled: true },
    ] as unknown as CronTask[])
    render(<Probe />)
    cronCallback?.({ taskId: 't1', lastStatus: 'error' })
    // 异步 resolveCronTask → 等 microtask 队列
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(1)
    })
    const items = useNotificationStore.getState().notifications
    expect(items[0].source).toBe('cron')
    expect(items[0].level).toBe('error')
    expect(items[0].title).toContain('每日学情汇总')
    expect(items[0].target).toBe('/scheduler')
  })

  it('skipped_circuit_breaker → 警告通知', async () => {
    render(<Probe />)
    cronCallback?.({ taskId: 't1', lastStatus: 'skipped_circuit_breaker' })
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(1)
    })
    const items = useNotificationStore.getState().notifications
    expect(items[0].level).toBe('warning')
    expect(items[0].title).toContain('熔断')
  })

  it('飞书同步任务(__feishu__) success → 成功通知', async () => {
    cronListMock.mockResolvedValue([
      { id: 't2', name: '飞书同步', agentId: '__feishu__', schedule: '0 * * * *', enabled: true },
    ] as unknown as CronTask[])
    render(<Probe />)
    cronCallback?.({ taskId: 't2', lastStatus: 'success' })
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(1)
    })
    const items = useNotificationStore.getState().notifications
    expect(items[0].level).toBe('success')
    expect(items[0].title).toContain('飞书同步完成')
  })

  it('agent 型任务 success 不通知(由 agent 事件覆盖)', async () => {
    cronListMock.mockResolvedValue([
      { id: 't3', name: '普通任务', agentId: 'a1', schedule: '0 * * * *', enabled: true },
    ] as unknown as CronTask[])
    render(<Probe />)
    cronCallback?.({ taskId: 't3', lastStatus: 'success' })
    // 等待异步解析完成(无通知产生)
    await vi.waitFor(() => expect(cronListMock).toHaveBeenCalled())
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('无 taskId 的 cron 事件被忽略', () => {
    render(<Probe />)
    cronCallback?.({ lastStatus: 'error' })
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })
})
