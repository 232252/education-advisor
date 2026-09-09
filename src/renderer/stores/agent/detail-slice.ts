// =============================================================
// Agent 详情 slice — selectAgent / refreshDetail / saveSoul / saveRules
// (详情加载含竞态保护)
// =============================================================

import { t } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../toastStore'
import { _flushLiveOutput } from './live-output'
import type { AgentGet, AgentSet, AgentState } from './types'

/** 修复: selectAgent 请求令牌,防止快速切换 Agent 时旧响应覆盖新数据 */
let _selectAgentReqId = 0

export function createDetailSlice(
  set: AgentSet,
  get: AgentGet,
): Pick<AgentState, 'selectAgent' | 'refreshDetail' | 'saveSoul' | 'saveRules'> {
  // SOUL/AGENTS 文档写入孪生动作参数化: 保存成功附带最新 detail,失败 toast+抛出
  const saveAgentDoc = async (
    id: string,
    content: string,
    setDoc: (id: string, content: string) => Promise<unknown>,
    docLabel: string,
    failToast: string,
  ): Promise<void> => {
    try {
      await setDoc(id, content)
      const detail = await getAPI().agent.get(id)
      set({ selectedDetail: detail })
    } catch (err) {
      console.error(`[AgentStore] Failed to save ${docLabel}:`, err)
      toast.error(failToast)
      throw err
    }
  }

  return {
    selectAgent: async (id) => {
      // PERF: 切换 agent 前先 flush 旧 agent 的批处理缓冲,避免丢失输出
      _flushLiveOutput(set)
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

    saveSoul: (id, content) =>
      saveAgentDoc(
        id,
        content,
        (i, c) => getAPI().agent.setSoul(i, c),
        'SOUL',
        t('toast.agent.saveSoulFailed', '保存 SOUL 失败'),
      ),

    saveRules: (id, content) =>
      saveAgentDoc(
        id,
        content,
        (i, c) => getAPI().agent.setRules(i, c),
        'rules',
        t('toast.agent.saveRulesFailed', '保存规则失败'),
      ),
  }
}
