// =============================================================
// Agent 详情 slice — selectAgent / refreshDetail / saveSoul / saveRules
// (详情加载含竞态保护)
// =============================================================

import { getAPI } from '../../lib/ipc-client'
import { toast } from '../toastStore'
import { _flushLiveOutputNow } from './live-output'
import type { AgentGet, AgentSet, AgentState } from './types'

/** 修复: selectAgent 请求令牌,防止快速切换 Agent 时旧响应覆盖新数据 */
let _selectAgentReqId = 0

export function createDetailSlice(
  set: AgentSet,
  get: AgentGet,
): Pick<AgentState, 'selectAgent' | 'refreshDetail' | 'saveSoul' | 'saveRules'> {
  return {
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
  }
}
