// =============================================================
// useAgentsData — Agent 列表数据加载与 store 订阅
// =============================================================

import { useEffect } from 'react'
import { useAgentStore } from '../../../stores/agentStore'

export function useAgentsData() {
  // OPT-2: 使用独立 selector 避免整个 store 订阅,防止流式输出时每 token 触发全页重渲染
  // PERF: liveOutput/liveToolCalls/isRunning 不在主页面订阅,RunTab 内部直接订阅
  //       避免流式输出触发整个 AgentsPage 重渲染
  const agents = useAgentStore((s) => s.agents)
  const loading = useAgentStore((s) => s.loading)
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId)
  const selectedDetail = useAgentStore((s) => s.selectedDetail)
  const detailLoading = useAgentStore((s) => s.detailLoading)
  // actions 引用稳定,无需细粒度 selector
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const toggleAgent = useAgentStore((s) => s.toggleAgent)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const runAgent = useAgentStore((s) => s.runAgent)
  const abortAgent = useAgentStore((s) => s.abortAgent)
  const saveSoul = useAgentStore((s) => s.saveSoul)
  const saveRules = useAgentStore((s) => s.saveRules)

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  return {
    agents,
    loading,
    selectedAgentId,
    selectedDetail,
    detailLoading,
    fetchAgents,
    toggleAgent,
    updateAgent,
    selectAgent,
    runAgent,
    abortAgent,
    saveSoul,
    saveRules,
  }
}
