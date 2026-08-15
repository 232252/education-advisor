// =============================================================
// Agent 控制台页面 — 完整的 Agent 管理与执行界面（编排层）
// 结构: 左侧列表(AgentListSidebar) + 右侧详情(AgentDetailPanel)
// =============================================================

import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { AgentDetailPanel } from './components/AgentDetailPanel'
import { AgentListSidebar } from './components/AgentListSidebar'
import { useAgentsData } from './hooks/useAgentsData'

export function AgentsPage() {
  const {
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
  } = useAgentsData()

  return (
    <div className="h-full flex animate-fade-in">
      {/* 左侧：Agent 列表 */}
      <AgentListSidebar
        agents={agents}
        loading={loading}
        selectedAgentId={selectedAgentId}
        onSelect={selectAgent}
        onToggle={toggleAgent}
        onRefresh={fetchAgents}
      />

      {/* 右侧：Agent 详情 */}
      <div className="flex-1 flex flex-col">
        {!selectedAgentId ? (
          <EmptyState
            icon={<ArrowLeft size={28} />}
            title="选择左侧 Agent 查看详情"
            description="每个 Agent 都有独立的角色定位、模型档位与定时任务。点击左侧卡片即可查看配置、运行记录与自定义提示词。"
          />
        ) : detailLoading ? (
          <EmptyState icon={<Loader2 className="h-7 w-7 animate-spin" />} title="加载中..." />
        ) : selectedDetail ? (
          <AgentDetailPanel
            detail={selectedDetail}
            onRun={runAgent}
            onAbort={abortAgent}
            onSaveSoul={saveSoul}
            onSaveRules={saveRules}
            onUpdate={updateAgent}
          />
        ) : (
          <EmptyState icon={<AlertTriangle size={28} />} title="加载失败" />
        )}
      </div>
    </div>
  )
}
