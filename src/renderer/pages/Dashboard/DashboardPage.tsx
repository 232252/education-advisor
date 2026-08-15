// =============================================================
// 仪表盘页面 — 编排层
// 职责：数据 hooks 装配 + 区块组件布局。
// 纯计算在 dashboard-stats.ts，图表 option 在各图表卡片组件内部构造，
// 数据加载在 hooks/useDashboardData.ts，筛选/派生在 hooks/useDashboardFilters.ts，
// 诊断动作在 hooks/useDashboardActions.ts，展示区块在 components/。
// =============================================================

import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/Skeleton'
import { useT } from '../../i18n'
import { ClassComparisonPanel } from './components/ClassComparisonPanel'
import { DashboardStatsRow } from './components/DashboardStatsRow'
import { DashboardToolbar } from './components/DashboardToolbar'
import { DoctorCard } from './components/DoctorCard'
import { EaaInfoCard } from './components/EaaInfoCard'
import { MaintenanceActionsCard } from './components/MaintenanceActionsCard'
import { PeriodSummaryCard } from './components/PeriodSummaryCard'
import { RankingCard } from './components/RankingCard'
import { ReasonDistCard } from './components/ReasonDistCard'
import { RiskDistChartCard } from './components/RiskDistChartCard'
import { ScoreDistChartCard } from './components/ScoreDistChartCard'
import { TagsOverviewCard } from './components/TagsOverviewCard'
import { ValidateCard } from './components/ValidateCard'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardData } from './hooks/useDashboardData'
import { useDashboardFilters } from './hooks/useDashboardFilters'

export function DashboardPage() {
  const { t } = useT()
  const navigate = useNavigate()
  // 8 路并行数据加载统一交给 useDashboardData（封装 useMultiLoader + IPC 解包）
  const {
    stats,
    summary,
    ranking,
    eaaInfo,
    tagData,
    allStudents,
    classList,
    allEvents,
    loading,
    errors,
    reload,
  } = useDashboardData()
  // 班级筛选 / 对比模式状态 + 派生视图数据
  const {
    classFilter,
    setClassFilter,
    compareMode,
    setCompareMode,
    compareClassA,
    setCompareClassA,
    compareClassB,
    setCompareClassB,
    activeClassList,
    filteredRanking,
    classStats,
    scoreIntervals,
    sortedScoreKeys,
    classReasonDist,
    classPeriodSummary,
    classComparison,
    compareDataA,
    compareDataB,
  } = useDashboardFilters({ classList, allStudents, ranking, allEvents })
  // 系统管理 & 诊断动作（doctor / validate / replay / 导出 HTML）
  const {
    doctorData,
    doctorRunning,
    runDoctor,
    validateData,
    validateRunning,
    runValidate,
    replayEvents,
    exportHtmlDashboard,
  } = useDashboardActions()

  // 记录失败的部分到控制台,便于调试（与原 loadData 行为一致：仅 console.warn，不弹 toast）
  useEffect(() => {
    if (!loading && Object.keys(errors).length > 0) {
      const failed = Object.keys(errors)
      console.warn(`[Dashboard] ${failed.length} fetches failed:`, failed)
    }
  }, [loading, errors])

  // 手动刷新：重新加载数据（Electron 版本无 invalidateCache，直接 reload）
  const handleRefresh = useCallback(() => {
    reload()
  }, [reload])

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-canvas">
        <PageHeader
          title={t('page.dashboard.title')}
          subtitle={t('page.dashboard.subtitle')}
          size="md"
        />
        <PageSkeleton />
      </div>
    )
  }

  const s = stats?.summary

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <PageHeader
        title={t('page.dashboard.title')}
        subtitle={t('page.dashboard.subtitle')}
        size="md"
        actions={
          <DashboardToolbar
            classFilter={classFilter}
            onClassFilterChange={setClassFilter}
            activeClassList={activeClassList}
            compareMode={compareMode}
            onCompareModeToggle={() => setCompareMode(!compareMode)}
            onRefresh={handleRefresh}
          />
        }
      />
      <div className="p-6 space-y-6">
        {/* 班级对比模式: 显示对比表格 */}
        {compareMode && (
          <ClassComparisonPanel
            classComparison={classComparison}
            activeClassList={activeClassList}
            compareClassA={compareClassA}
            compareClassB={compareClassB}
            onCompareClassAChange={setCompareClassA}
            onCompareClassBChange={setCompareClassB}
            compareDataA={compareDataA}
            compareDataB={compareDataB}
          />
        )}

        {/* 概览卡片 — 按班级筛选时显示班级数据 */}
        <DashboardStatsRow
          isAllClasses={classFilter === '__ALL__'}
          studentCount={classStats.total}
          eventCount={classPeriodSummary.events.total}
          revokedCount={s?.reverted_events ?? 0}
          scoreChange={
            classFilter === '__ALL__'
              ? (s?.total_delta?.toFixed(1) ?? '-')
              : classStats.avgScore.toFixed(1)
          }
          highRiskCount={classStats.highRisk}
        />

        {/* 图表区 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ScoreDistChartCard scoreIntervals={scoreIntervals} sortedScoreKeys={sortedScoreKeys} />
          <RiskDistChartCard riskDistribution={classStats.riskDistribution} />
        </div>

        {/* 下半部分 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ReasonDistCard items={classReasonDist} />
          <RankingCard
            items={filteredRanking}
            onSelectStudent={(entityId) =>
              navigate(`/students?entity_id=${encodeURIComponent(entityId)}`)
            }
          />
          <PeriodSummaryCard data={classPeriodSummary} period={summary?.period} />
        </div>

        {/* 系统管理 & 诊断 */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 tracking-tight">
              {t('page.dashboard.sysmgmt.title')}
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <EaaInfoCard info={eaaInfo} />
          <DoctorCard data={doctorData} running={doctorRunning} onRun={runDoctor} />
          <ValidateCard data={validateData} running={validateRunning} onRun={runValidate} />
        </div>

        {/* 标签概览 + 操作按钮区 */}
        <div className="grid grid-cols-3 gap-6">
          <TagsOverviewCard tagData={tagData} />
          <MaintenanceActionsCard onReplay={replayEvents} onExportHtml={exportHtmlDashboard} />
        </div>
      </div>
    </div>
  )
}
