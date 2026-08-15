// =============================================================
// 状态订阅 slice — initStatusListener / subscribeStatus / _handleStatusUpdate
// (IPC 状态事件的主订阅入口与派生订阅总线)
// =============================================================

import type { AgentListItem } from '@shared/types'
import { getAPI } from '../../lib/ipc-client'
import { _appendLiveOutput, _flushLiveOutputNow } from './live-output'
import type { AgentGet, AgentSet, AgentState, AgentStatusUpdate } from './types'

export function createStatusSlice(
  set: AgentSet,
  get: AgentGet,
): Pick<AgentState, 'initStatusListener' | 'subscribeStatus' | '_handleStatusUpdate'> {
  return {
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
      //(subscribers复制一份避免迭代过程中回调内修改导致错乱)
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
  }
}
