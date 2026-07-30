// =============================================================
// Agent Store — Agent 状态管理 (Zustand)
// =============================================================

import type { AgentDetail, AgentExecution, AgentListItem } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'
import { toast } from './toastStore'

/** 修复: selectAgent 请求令牌,防止快速切换 Agent 时旧响应覆盖新数据 */
let _selectAgentReqId = 0

/**
 * PERF: 流式 delta 批处理 — 把高频 text_delta 合并到 50ms 一次 set(),
 * 避免每个 delta 触发一次 Zustand 状态更新和组件重渲染。
 * 仿 chatStore 的 deltaBatch 机制。
 */
let _liveOutputBatch: string[] = []
let _liveOutputTimer: ReturnType<typeof setTimeout> | null = null
const LIVE_OUTPUT_BATCH_MS = 50
// R95 修复: 限制 liveOutput 最大字符数 (1MB),防止长 agent 运行导致内存无界增长
const LIVE_OUTPUT_MAX_CHARS = 1_000_000

function _flushLiveOutput(set: (fn: (s: AgentState) => Partial<AgentState>) => void): void {
  if (_liveOutputTimer) {
    clearTimeout(_liveOutputTimer)
    _liveOutputTimer = null
  }
  if (_liveOutputBatch.length === 0) return
  const combined = _liveOutputBatch.join('')
  _liveOutputBatch = []
  if (!combined) return
  set((s) => {
    const next = s.liveOutput + combined
    // 超过上限时保留尾部 (最新输出),截断头部
    if (next.length > LIVE_OUTPUT_MAX_CHARS) {
      return {
        liveOutput: `\n…[输出已截断,仅保留最近 ${LIVE_OUTPUT_MAX_CHARS} 字符]\n${next.slice(-LIVE_OUTPUT_MAX_CHARS)}`,
      }
    }
    return { liveOutput: next }
  })
}

/** 立即刷新批处理 — 用于状态切换(running→idle/error)前确保输出完整 */
function _flushLiveOutputNow(set: (fn: (s: AgentState) => Partial<AgentState>) => void): void {
  _flushLiveOutput(set)
}

function _appendLiveOutput(
  delta: string,
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
): void {
  if (!delta) return
  _liveOutputBatch.push(delta)
  if (_liveOutputTimer) return
  _liveOutputTimer = setTimeout(() => {
    _liveOutputTimer = null
    _flushLiveOutput(set)
  }, LIVE_OUTPUT_BATCH_MS)
}

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
      mcpServers: string[]
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
      // 修复: 读取最新的 _statusListeners,而非闭包捕获的旧引用
      // 避免 unsubscribe A 后 unsubscribe B 把 A 重新加回 Set
      const current = get()._statusListeners
      const next = new Set(current)
      next.delete(fn)
      set({ _statusListeners: next })
    }
  },

  _handleStatusUpdate: (data) => {
    const { selectedAgentId } = get()

    // 更新 agent列表中的状态
    // OPT-4: 跳过状态未变化的 agent,避免无条件重建数组引用导致不必要的重渲染
    set((s) => {
      const existing = s.agents.find((a) => a.id === data.agentId)
      if (!existing || existing.status === (data.status as AgentListItem['status'])) {
        return {} // 状态未变,不触发更新
      }
      return {
        agents: s.agents.map((a) =>
          a.id === data.agentId ? { ...a, status: data.status as AgentListItem['status'] } : a,
        ),
      }
    })

    // 如果是当前选中的 agent,追加输出
    if (data.agentId === selectedAgentId) {
      // 状态切换前先 flush 待处理的 delta,确保输出完整
      // (running→idle/error / 错误追加 / result 追加 等场景都需要先 flush)
      const needFlush =
        data.status === 'idle' || data.status === 'error' || !!data.error || !!data.result
      if (needFlush) {
        _flushLiveOutputNow(set)
      }

      //追加实时输出(批处理)
      if (data.output) {
        _appendLiveOutput(data.output, set)
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
      // PERF: IPC_AGENT_UPDATE 已返回 agents + detail,无需再发 2 次 IPC
      const { agents, detail } = result as {
        success: boolean
        error?: string
        agents?: AgentListItem[]
        detail?: AgentDetail | null
      }
      if (agents) set({ agents })
      const { selectedAgentId } = get()
      if (selectedAgentId === id && detail !== undefined) {
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
    // PERF: 切换 agent 前先 flush 旧 agent 的批处理缓冲,避免丢失输出
    _flushLiveOutputNow(set)
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
    // 修复: 请求令牌防止竞态(快速切换 Agent 时旧响应覆盖新数据)
    const reqId = ++_selectAgentReqId
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
      // 仅当这是最新请求时才更新,避免快速切换 A→B 时 A 的响应覆盖 B
      if (reqId === _selectAgentReqId) {
        set({ selectedDetail: detail, detailLoading: false })
      }
    } catch (err) {
      console.error('[agentStore] selectAgent get detail failed:', err)
      if (reqId === _selectAgentReqId) {
        set({ detailLoading: false })
      }
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
    // PERF: 启动新 run 前先 flush 旧输出并清空批处理缓冲
    _flushLiveOutputNow(set)
    _liveOutputBatch = []
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

  clearOutput: () => {
    // PERF: 清理批处理缓冲,避免遗留的 timer 在 clear 后再次 set
    if (_liveOutputTimer) {
      clearTimeout(_liveOutputTimer)
      _liveOutputTimer = null
    }
    _liveOutputBatch = []
    set({ liveOutput: '', liveToolCalls: [], lastExecution: null, lastError: null })
  },
}))
