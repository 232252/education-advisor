// =============================================================
// Agent 列表 slice — fetchAgents / toggleAgent / updateAgent
// =============================================================

import type { AgentDetail, AgentListItem } from '@shared/types'
import { t } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../toastStore'
import type { AgentGet, AgentSet, AgentState } from './types'

export function createListSlice(
  set: AgentSet,
  get: AgentGet,
): Pick<AgentState, 'fetchAgents' | 'toggleAgent' | 'updateAgent'> {
  return {
    fetchAgents: async () => {
      set({ loading: true })
      try {
        const agents = await getAPI().agent.list()
        set({ agents, loading: false })
      } catch (err) {
        console.error('[AgentStore] Failed to fetch agents:', err)
        toast.error(t('toast.agent.loadFailed', '加载 Agent 列表失败'))
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
        toast.error(t(enabled ? 'toast.agent.enableFailed' : 'toast.agent.disableFailed'))
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
        toast.success(t('toast.agent.updated'))
      } catch (err) {
        console.error('[AgentStore] Failed to update agent:', err)
        toast.error(t('toast.agent.updateFailed'))
        throw err
      }
    },
  }
}
