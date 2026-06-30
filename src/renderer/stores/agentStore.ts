// =============================================================
// Agent Store — Agent 状态管理 (Zustand)
// =============================================================

import type { AgentDetail, AgentExecution, AgentListItem } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'
import { toast } from './toastStore'

interface AgentStatusUpdate {
  agentId: string
  status: string
  output?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; isError: boolean }
  result?: AgentExecution
  error?: string
}

interface AgentState {
  agents: AgentListItem[]
  loading: boolean
  selectedAgentId: string | null
  selectedDetail: AgentDetail | null
  detailLoading: boolean
  liveOutput: string
  liveToolCalls: Array<{ name: string; args: unknown; time: number }>
  isRunning: boolean
  lastExecution: AgentExecution | null
  lastError: string | null

  // Actions
  fetchAgents: () => Promise<void>
  toggleAgent: (id: string, enabled: boolean) => Promise<void>
  updateAgent: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      modelTier: 'high_quality' | 'low_cost'
      capabilities: string[]
    }>,
  ) => Promise<void>
  selectAgent: (id: string | null) => Promise<void>
  refreshDetail: () => Promise<void>
  runAgent: (id: string, prompt: string) => Promise<void>
  abortAgent: (id: string) => Promise<void>
  saveSoul: (id: string, content: string) => Promise<void>
  saveRules: (id: string, content: string) => Promise<void>
  clearOutput: () => void

  // 内部
  _handleStatusUpdate: (data: AgentStatusUpdate) => void
  _unsubscribeStatus: (() => void) | null
  _statusListeners: Set<(data: AgentStatusUpdate) => void>
  initStatusListener: () => void
  /**
   *派生订阅入口 — 让其他 store /组件订阅 agent状态变化,
   * 而不必各自调用 getAPI().agent.onStatusUpdate,避免重复订阅。
   * agentStore 是 IPC_AGENT_STATUS_UPDATE 的唯一主订阅者;
   * 其他消费者通过 subscribeStatus 注册回调,事件触发时同步转发
   * (不经过 React批量更新,避免流式事件被合并丢失)。
   */
  subscribeStatus: (fn: (data: AgentStatusUpdate) => void) => () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loading: false,
  selectedAgentId: null,
  selectedDetail: null,
  detailLoading: false,
  liveOutput: '',
  liveToolCalls: [],
  isRunning: false,
  lastExecution: null,
  lastError: null,
  _unsubscribeStatus: null,
  //派生订阅者列表 — 在 _handleStatusUpdate 中同步调用
  _statusListeners: new Set<(data: AgentStatusUpdate) => void>(),

  initStatusListener: () => {
    // 先清理旧的监听器,防止重复挂载导致泄漏
    const oldUnsub = get()._unsubscribeStatus
    if (oldUnsub) oldUnsub()

    const unsub = getAPI().agent.onStatusUpdate((data) => {
      get()._handleStatusUpdate(data as AgentStatusUpdate)
    })
    set({ _unsubscribeStatus: unsub })
  },

  /**
   * 注册一个派生订阅者,在每个 agent状态事件触发时同步回调。
   * 返回取消订阅函数。多次调用 initStatusListener不会产生多个 IPC监听器,
   *派生订阅者始终通过这同一个总线接收事件。
   */
  subscribeStatus: (fn) => {
    const listeners = get()._statusListeners
    listeners.add(fn)
    return () => {
      // 删除时复制一份,避免迭代过程中变更原 Set
      const next = new Set(listeners)
      next.delete(fn)
      set({ _statusListeners: next })
    }
  },

  _handleStatusUpdate: (data) => {
    const { selectedAgentId } = get()

    // 更新 agent列表中的状态
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === data.agentId ? { ...a, status: data.status as AgentListItem['status'] } : a,
      ),
    }))

    // 如果是当前选中的 agent,追加输出
    if (data.agentId === selectedAgentId) {
      //追加实时输出
      if (data.output) {
        set((s) => ({ liveOutput: s.liveOutput + data.output }))
      }

      //记录工具调用
      if (data.toolCall) {
        const toolCall = data.toolCall
        set((s) => ({
          liveToolCalls: [...s.liveToolCalls, { ...toolCall, time: Date.now() }],
        }))
      }

      // 设置运行状态
      if (data.status === 'running') {
        set({ isRunning: true, lastError: null })
      }

      // 处理执行结果
      if (data.result) {
        set({ lastExecution: data.result })
        // 如果有结果输出但 liveOutput 为空,也追加到 liveOutput
        if (data.result.output && !get().liveOutput) {
          set({ liveOutput: data.result.output })
        }
      }

      // 处理错误
      if (data.error) {
        const errMsg = data.error
        set((s) => ({
          lastError: errMsg,
          liveOutput: `${s.liveOutput}\n\n❌错误: ${errMsg}\n`,
        }))
      }

      // 执行结束
      if (data.status === 'idle' || data.status === 'error') {
        set({ isRunning: false })
        // C-4 修复: 执行结束后刷新详情(获取最新的 executionHistory),但不清空 liveOutput
        // 之前调 selectAgent 会清空 liveOutput/liveToolCalls/lastExecution/lastError,
        // 导致 Agent 执行完成瞬间输出区变空白,用户看不到最终结果
        if (selectedAgentId) {
          get().refreshDetail()
        }
      }
    }

    //同步派发给派生订阅者 — 不走 React批量更新,避免流式事件被合并
    // 用 forEach 而非 for..of 以便 set 在迭代过程中变更时也能安全遍历
    // (subscribers复制一份避免迭代过程中回调内修改导致错乱)
    const listeners = get()._statusListeners
    if (listeners.size > 0) {
      const snapshot = Array.from(listeners)
      for (const fn of snapshot) {
        try {
          fn(data)
        } catch (err) {
          //订阅者抛错不影响主流程,仅打印
          console.error('[AgentStore] status subscriber threw:', err)
        }
      }
    }
  },

  fetchAgents: async () => {
    set({ loading: true })
    try {
      const agents = await getAPI().agent.list()
      set({ agents, loading: false })
    } catch (err) {
      console.error('[AgentStore] Failed to fetch agents:', err)
      toast.error('加载 Agent 列表失败')
      set({ loading: false })
    }
  },

  toggleAgent: async (id, enabled) => {
    try {
      await getAPI().agent.toggle(id, enabled)
      set((s) => ({
        agents: s.agents.map((a) => (a.id === id ? { ...a, enabled } : a)),
      }))
    } catch (err) {
      console.error('[AgentStore] Failed to toggle agent:', err)
      toast.error(`${enabled ? '启用' : '停用'} Agent 失败`)
      throw err
    }
  },

  updateAgent: async (id, patch) => {
    try {
      const result = await getAPI().agent.update(id, patch)
      if (!result.success) {
        toast.error(result.error || '更新 Agent 失败')
        return
      }
      // 刷新列表和详情
      const agents = await getAPI().agent.list()
      set({ agents })
      const { selectedAgentId } = get()
      if (selectedAgentId === id) {
        const detail = await getAPI().agent.get(id)
        set({ selectedDetail: detail })
      }
      toast.success('Agent 配置已更新')
    } catch (err) {
      console.error('[AgentStore] Failed to update agent:', err)
      toast.error('更新 Agent 配置失败')
      throw err
    }
  },

  selectAgent: async (id) => {
    if (!id) {
      set({
        selectedAgentId: null,
        selectedDetail: null,
        liveOutput: '',
        liveToolCalls: [],
        lastExecution: null,
        lastError: null,
      })
      return
    }
    set({
      selectedAgentId: id,
      detailLoading: true,
      liveOutput: '',
      liveToolCalls: [],
      lastExecution: null,
      lastError: null,
    })
    try {
      const detail = await getAPI().agent.get(id)
      set({ selectedDetail: detail, detailLoading: false })
    } catch (err) {
      // Medium 修复: 不再静默吞错,记录错误日志便于排查
      console.error('[agentStore] selectAgent get detail failed:', err)
      set({ detailLoading: false })
    }
  },

  /**
   * C-4 修复: 只刷新 selectedDetail(获取最新 executionHistory),不清空 liveOutput/liveToolCalls/lastExecution/lastError
   * 用于 Agent 执行结束后刷新详情,保留用户刚看到的输出
   */
  refreshDetail: async () => {
    const { selectedAgentId } = get()
    if (!selectedAgentId) return
    try {
      const detail = await getAPI().agent.get(selectedAgentId)
      set({ selectedDetail: detail })
    } catch (err) {
      console.warn('[AgentStore] refreshDetail failed:', err)
    }
  },

  runAgent: async (id, prompt) => {
    set({
      liveOutput: '',
      liveToolCalls: [],
      isRunning: true,
      lastExecution: null,
      lastError: null,
    })
    try {
      await getAPI().agent.runManual(id, prompt)
    } catch (err) {
      console.error('[AgentStore] Failed to run agent:', err)
      toast.error('执行 Agent 失败')
      set({ isRunning: false })
    }
  },

  abortAgent: async (id) => {
    try {
      await getAPI().agent.abort(id)
      set({ isRunning: false })
    } catch (err) {
      console.error('[AgentStore] Failed to abort agent:', err)
      toast.error('中止 Agent 失败')
    }
  },

  saveSoul: async (id, content) => {
    try {
      await getAPI().agent.setSoul(id, content)
      const detail = await getAPI().agent.get(id)
      set({ selectedDetail: detail })
    } catch (err) {
      console.error('[AgentStore] Failed to save SOUL:', err)
      toast.error('保存 SOUL 失败')
      throw err
    }
  },

  saveRules: async (id, content) => {
    try {
      await getAPI().agent.setRules(id, content)
      const detail = await getAPI().agent.get(id)
      set({ selectedDetail: detail })
    } catch (err) {
      console.error('[AgentStore] Failed to save rules:', err)
      toast.error('保存规则失败')
      throw err
    }
  },

  clearOutput: () =>
    set({ liveOutput: '', liveToolCalls: [], lastExecution: null, lastError: null }),
}))
