// =============================================================
// Agent 控制台页面 — 完整的 Agent 管理与执行界面（编排层）
// 结构: 左侧列表(AgentListSidebar) + 右侧详情(AgentDetailPanel)
// =============================================================

import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { Skeleton } from '../../components/Skeleton'
import { useT } from '../../i18n'
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
  const { t } = useT()

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
            title={t('page.agents.detail.empty', '选择左侧 Agent 查看详情')}
            description={t(
              'page.agents.detail.emptyDesc',
              '每个 Agent 都有独立的角色定位、模型档位与定时任务。点击左侧卡片即可查看配置、运行记录与自定义提示词。',
            )}
          />
        ) : detailLoading ? (
          <div className="flex-1 p-4 space-y-4 animate-fade-in">
            {/* 头部：名称 + 状态徽标 */}
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            {/* Tab 栏 */}
            <div className="flex gap-4 border-b border-gray-200/70 dark:border-white/[0.06] pb-2">
              {Array.from({ length: 4 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素，不会重排序
                <Skeleton key={`tab-${i}`} className="h-4 w-16" />
              ))}
            </div>
            {/* Tab 内容区 */}
            <div className="pt-2 space-y-3">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
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
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title={t('toast.common.loadFailed', '加载失败')}
          />
        )}
      </div>
    </div>
  )
}
