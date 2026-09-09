// =============================================================
// useAgentAnalysis — 学生 AI 分析域 hook 测试
// 覆盖: toggleAgent 勾选 / runSelected&runAll 串行执行 /
//       subscribeStatus 输出聚合(agentId 过滤) / 错误处理 /
//       卸载中止(R95) / saveAiResult 保存
// settle 为事件驱动(runManual 已启动即 resolve): 测试需逐个喂
// idle 终态事件驱动串行循环放行
// =============================================================

import { act } from 'react'
import { setWindowApi, clearWindowApi } from '../../helpers/window-api'
import { toastMocks } from '../../helpers/mock-toast'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentListItem, EAAStudent, StudentProfileData } from '@shared/types'
import { useAgentAnalysis } from '../../../../src/renderer/pages/Students/hooks/useAgentAnalysis'
import { useAgentStore } from '../../../../src/renderer/stores/agent/store'
import { makeAgent as makeAgentBase } from '../../__fixtures__/make'

// ---------- toast mock ----------

vi.mock('../../../../src/renderer/stores/toastStore', async () => (await import('../../helpers/mock-toast')).mockToastStore)

// ---------- window.api mock ----------

const apiMocks = vi.hoisted(() => ({
  runManual: vi.fn(),
  profileSet: vi.fn(),
}))

function installApi() {
  ;setWindowApi({
    agent: { runManual: apiMocks.runManual },
    profile: { set: apiMocks.profileSet },
  })
}

// ---------- 测试数据 ----------

const student: EAAStudent = {
  name: '甲',
  entity_id: 'e1',
  score: 55,
  delta: -2,
  risk: '极高',
  status: 'Active',
  events_count: 6,
  groups: [],
  roles: [],
  class_id: 'G7-1',
}

// 历史签名为 (id, enabled) 且 name 由 id 推导,用适配器保持原值
const makeAgent = (id: string, enabled: boolean): AgentListItem =>
  makeAgentBase({ id, name: `agent-${id}`, role: 'r', description: 'd', enabled })

const profileData: StudentProfileData = { comments: '测试档案' }

function emitStatus(payload: {
  agentId: string
  status: 'idle' | 'running' | 'error'
  output?: string
  error?: string
}) {
  useAgentStore.getState()._handleStatusUpdate(payload)
}

/** 事件驱动 settle 的测试驱动器: 每次 runManual resolve 后喂 idle 终态放行 */
async function driveRun(run: () => Promise<void>, agentIds: string[]) {
  await act(async () => {
    const p = run()
    for (const id of agentIds) {
      // 冲刷微任务: runManual resolve → 循环推进 → settle 挂上观察订阅
      await vi.advanceTimersByTimeAsync(0)
      emitStatus({ agentId: id, status: 'idle' })
    }
    await vi.advanceTimersByTimeAsync(0)
    await p
  })
}

describe('useAgentAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    installApi()
    apiMocks.runManual.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    // 清理可能残留的派生订阅者
    useAgentStore.setState({ _statusListeners: new Set() })
    vi.useRealTimers()
    clearWindowApi()
  })

  const setup = (agents: AgentListItem[] = [makeAgent('a1', true), makeAgent('a2', true)]) =>
    renderHook(() => useAgentAnalysis(student, agents, profileData))

  // ---------- 勾选 ----------

  it('初始: 无勾选 / 未运行 / 输出为空', () => {
    const { result } = setup()
    expect(result.current.selectedAgents.size).toBe(0)
    expect(result.current.aiRunning).toBe(false)
    expect(result.current.aiOutput).toBe('')
    expect(result.current.aiMessage).toBe('')
    expect(result.current.aiSaved).toBe(false)
  })

  it('toggleAgent: 勾选与取消', () => {
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
    })
    expect(result.current.selectedAgents.has('a1')).toBe(true)
    act(() => {
      result.current.toggleAgent('a1')
    })
    expect(result.current.selectedAgents.has('a1')).toBe(false)
  })

  // ---------- runSelected ----------

  it('未勾选任何 agent: 提示且不执行', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.runSelected()
    })
    expect(result.current.aiMessage).toBe('请至少选择一个Agent')
    expect(apiMocks.runManual).not.toHaveBeenCalled()
  })

  it('runSelected: 串行执行勾选的 agent, prompt 含学生信息', async () => {
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
      result.current.toggleAgent('a2')
    })

    await driveRun(() => result.current.runSelected(), ['a1', 'a2'])

    expect(apiMocks.runManual).toHaveBeenCalledTimes(2)
    expect(apiMocks.runManual.mock.calls[0][0]).toBe('a1')
    expect(apiMocks.runManual.mock.calls[1][0]).toBe('a2')
    // prompt 包含学生姓名与风险等级
    expect(apiMocks.runManual.mock.calls[0][1]).toContain('甲')
    expect(apiMocks.runManual.mock.calls[0][1]).toContain('极高')
    // 输出含每个 agent 的标题分隔
    expect(result.current.aiOutput).toContain('=== 🤖 a1 ===')
    expect(result.current.aiOutput).toContain('=== 🤖 a2 ===')
    expect(result.current.aiMessage).toBe('AI 分析完成')
    expect(result.current.aiRunning).toBe(false)
  })

  it('runSelected: 执行期间 aiRunning=true, 结束复位', async () => {
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
    })

    let p!: Promise<void>
    await act(async () => {
      p = result.current.runSelected()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.aiRunning).toBe(true)

    await act(async () => {
      emitStatus({ agentId: 'a1', status: 'idle' })
      await vi.advanceTimersByTimeAsync(0)
      await p
    })
    expect(result.current.aiRunning).toBe(false)
  })

  it('runManual 抛错: aiMessage 含错误信息且复位运行态', async () => {
    apiMocks.runManual.mockRejectedValue(new Error('agent crashed'))
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
    })

    await act(async () => {
      await result.current.runSelected()
    })

    expect(result.current.aiMessage).toContain('分析失败')
    expect(result.current.aiMessage).toContain('agent crashed')
    expect(result.current.aiRunning).toBe(false)
  })

  // ---------- 状态事件聚合(agentId 过滤) ----------

  it('订阅状态事件: 追加当前 agent 的流式输出', async () => {
    apiMocks.runManual.mockImplementation(async (id: string) => {
      emitStatus({ agentId: id, status: 'running', output: `[${id}] 流式输出` })
      return { success: true }
    })
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
    })

    await driveRun(() => result.current.runSelected(), ['a1'])

    expect(result.current.aiOutput).toContain('[a1] 流式输出')
  })

  it('其他 agent 的状态事件不串扰到输出', async () => {
    apiMocks.runManual.mockImplementation(async () => {
      emitStatus({ agentId: 'other-agent', status: 'running', output: '别人的输出' })
      return { success: true }
    })
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
    })

    await driveRun(() => result.current.runSelected(), ['a1'])

    expect(result.current.aiOutput).not.toContain('别人的输出')
  })

  it('状态事件携带 error: 输出追加错误行', async () => {
    apiMocks.runManual.mockImplementation(async (id: string) => {
      emitStatus({ agentId: id, status: 'error', error: 'boom' })
      return { success: true }
    })
    const { result } = setup()
    act(() => {
      result.current.toggleAgent('a1')
    })

    await driveRun(() => result.current.runSelected(), ['a1'])

    expect(result.current.aiOutput).toContain('[错误] boom')
  })

  // ---------- runAll ----------

  it('runAll: 只执行启用的 agent 并同步勾选', async () => {
    const { result } = setup([makeAgent('a1', true), makeAgent('a2', false)])
    await driveRun(() => result.current.runAll(), ['a1'])

    expect(apiMocks.runManual).toHaveBeenCalledTimes(1)
    expect(apiMocks.runManual.mock.calls[0][0]).toBe('a1')
    expect(result.current.selectedAgents.has('a1')).toBe(true)
    expect(result.current.selectedAgents.has('a2')).toBe(false)
  })

  it('runAll: 无可用 agent 时提示', async () => {
    const { result } = setup([makeAgent('a1', false)])
    await act(async () => {
      await result.current.runAll()
    })
    expect(result.current.aiMessage).toBe('没有可用的Agent')
    expect(apiMocks.runManual).not.toHaveBeenCalled()
  })

  // ---------- R95 卸载中止 ----------

  it('组件卸载后立即中止后续 agent 执行(R95)', async () => {
    let calls = 0
    apiMocks.runManual.mockImplementation(async () => {
      calls++
      if (calls === 1) unmountRef()
      return { success: true }
    })
    const agents = [makeAgent('a1', true), makeAgent('a2', true)]
    const rendered = renderHook(() => useAgentAnalysis(student, agents, profileData))
    const unmountRef = () => rendered.unmount()

    // 第一个 agent 执行时卸载: settle(a1) 仍需 idle 放行才能到达下一轮检查
    await driveRun(() => rendered.result.current.runAll(), ['a1'])

    // 第一个 agent 执行时卸载 → 循环中断, 第二个不再执行
    expect(calls).toBe(1)
  })

  // ---------- saveAiResult ----------

  it('saveAiResult 成功: aiSaved=true 且 success toast', async () => {
    apiMocks.profileSet.mockResolvedValue({ success: true })
    const { result } = setup()

    await act(async () => {
      await result.current.saveAiResult()
    })

    expect(apiMocks.profileSet).toHaveBeenCalledWith('甲', expect.objectContaining({
      comments: '测试档案',
      aiAnalysis: '',
    }))
    expect(result.current.aiSaved).toBe(true)
    expect(toastMocks.success).toHaveBeenCalledTimes(1)
  })

  it('saveAiResult 失败(res.success=false): 不标记已保存', async () => {
    apiMocks.profileSet.mockResolvedValue({ success: false })
    const { result } = setup()

    await act(async () => {
      await result.current.saveAiResult()
    })

    expect(result.current.aiSaved).toBe(false)
    expect(toastMocks.success).not.toHaveBeenCalled()
  })

  it('saveAiResult 抛错: error toast', async () => {
    apiMocks.profileSet.mockRejectedValue(new Error('db locked'))
    const { result } = setup()

    await act(async () => {
      await result.current.saveAiResult()
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(result.current.aiSaved).toBe(false)
  })
})
