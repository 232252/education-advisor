// =============================================================
// 仪表盘页面 — 编排层
// 职责：数据 hooks 装配 + 区块组件布局。
// 纯计算在 dashboard-stats.ts / dashboard-academic-stats.ts，
// 图表 option 在各图表卡片组件内部构造，
// 数据加载在 hooks/useDashboardData.ts + useDashboardAcademicData.ts，
// 筛选/派生在 hooks/useDashboardFilters.ts，
// 诊断动作在 hooks/useDashboardActions.ts，展示区块在 components/。
//
// 两种视图镜头（操行优先 / 成绩优先）共享页头、班级筛选与系统管理区，
// 不是「班主任 / 科任」身份切换——班主任也可以切到成绩优先。
// =============================================================

import { AlertTriangle, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/Skeleton'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useT } from '../../i18n'
import { CLASS_FILTER_ALL } from '../../lib/class-filter'
import { AcademicDashboardBody } from './components/AcademicDashboardBody'
import { ClassComparisonPanel } from './components/ClassComparisonPanel'
import { DashboardCardSkeleton } from './components/DashboardCardSkeleton'
import { DashboardStatsRow } from './components/DashboardStatsRow'
import { DashboardToolbar } from './components/DashboardToolbar'
import { DoctorCard } from './components/DoctorCard'
import { EaaInfoCard } from './components/EaaInfoCard'
import { MaintenanceActionsCard } from './components/MaintenanceActionsCard'
import { MemoCard } from './components/MemoCard'
import { PeriodSummaryCard } from './components/PeriodSummaryCard'
import { RankingCard } from './components/RankingCard'
import { ReasonDistCard } from './components/ReasonDistCard'
import { RiskDistChartCard } from './components/RiskDistChartCard'
import { ScoreDistChartCard } from './components/ScoreDistChartCard'
import { TagsOverviewCard } from './components/TagsOverviewCard'
import { ValidateCard } from './components/ValidateCard'
import { DASHBOARD_LENS_KEY, parseDashboardLens } from './dashboard-lens'
import { useDashboardAcademicData } from './hooks/useDashboardAcademicData'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardData } from './hooks/useDashboardData'
import { useDashboardFilters } from './hooks/useDashboardFilters'

export function DashboardPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const [storedLens, setStoredLens] = useLocalStorage<string>(DASHBOARD_LENS_KEY, 'conduct')
  const lens = parseDashboardLens(storedLens)
  const isGrades = lens === 'grades'

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
    readyKeys,
    reload,
  } = useDashboardData()

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
    filteredStudents,
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

  const studentNames = useMemo(() => filteredStudents.map((s) => s.name), [filteredStudents])
  const academic = useDashboardAcademicData({ enabled: isGrades, studentNames })

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

  useEffect(() => {
    if (!loading && Object.keys(errors).length > 0) {
      const failed = Object.keys(errors)
      console.warn(`[Dashboard] ${failed.length} fetches failed:`, failed)
    }
  }, [loading, errors])

  const failedSources = [
    ...Object.keys(errors),
    ...(isGrades ? Object.keys(academic.errors) : []),
  ].join(', ')
  const failedCount =
    Object.keys(errors).length + (isGrades ? Object.keys(academic.errors).length : 0)

  // 备忘卡片独立于 lens/班级筛选,挂全局刷新即可(refreshKey 递增触发重载)
  const [memoRefreshKey, setMemoRefreshKey] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: setMemoRefreshKey 是 useState setter(稳定引用),列与不列均被该规则误报
  const handleRefresh = useCallback(() => {
    reload()
    if (isGrades) academic.reload()
    setMemoRefreshKey((k) => k + 1)
  }, [reload, isGrades, academic.reload])

  const CORE_KEYS = ['stats', 'summary', 'allStudents', 'classList', 'tagData', 'eaaInfo'] as const
  const GRADES_CORE_KEYS = ['allStudents', 'classList'] as const
  const coreReady = isGrades
    ? GRADES_CORE_KEYS.every((k) => readyKeys.has(k))
    : CORE_KEYS.every((k) => readyKeys.has(k))
  if (!coreReady) {
    return (
      <div className="h-full overflow-y-auto bg-canvas">
        <PageHeader
          title={t('page.dashboard.title')}
          subtitle={isGrades ? t('page.dashboard.subtitle.grades') : t('page.dashboard.subtitle')}
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
        subtitle={isGrades ? t('page.dashboard.subtitle.grades') : t('page.dashboard.subtitle')}
        size="md"
        actions={
          <DashboardToolbar
            classFilter={classFilter}
            onClassFilterChange={setClassFilter}
            activeClassList={activeClassList}
            compareMode={compareMode}
            onCompareModeToggle={() => setCompareMode(!compareMode)}
            onRefresh={handleRefresh}
            lens={lens}
            onLensChange={setStoredLens}
            exams={academic.exams}
            examId={academic.examId}
            onExamIdChange={academic.setExamId}
            subjects={academic.subjects}
            subjectId={academic.subjectId}
            onSubjectIdChange={academic.setSubjectId}
          />
        }
      />
      <div className="p-6 space-y-6">
        {failedCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {t('page.dashboard.partialLoadFailed', `${failedCount} 项数据加载失败`)}:
                <span className="ml-1 font-mono opacity-75">{failedSources}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<RotateCw className="h-3.5 w-3.5" />}
              onClick={handleRefresh}
            >
              {t('common.retry', '重试')}
            </Button>
          </div>
        )}

        {isGrades ? (
          <AcademicDashboardBody
            students={filteredStudents}
            exams={academic.exams}
            subjects={academic.subjects}
            examId={academic.examId}
            subjectId={academic.subjectId}
            classGrades={academic.classGrades}
            catalogReady={academic.catalogReady}
            gradesReady={academic.gradesReady}
          />
        ) : (
          <>
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

            {readyKeys.has('allEvents') ? (
              <DashboardStatsRow
                isAllClasses={classFilter === CLASS_FILTER_ALL}
                studentCount={classStats.total}
                eventCount={classPeriodSummary.events.total}
                revokedCount={s?.reverted_events ?? 0}
                scoreChange={
                  classFilter === CLASS_FILTER_ALL
                    ? (s?.total_delta?.toFixed(1) ?? '-')
                    : classStats.avgScore.toFixed(1)
                }
                highRiskCount={classStats.highRisk}
              />
            ) : (
              <DashboardCardSkeleton />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ScoreDistChartCard
                scoreIntervals={scoreIntervals}
                sortedScoreKeys={sortedScoreKeys}
              />
              <RiskDistChartCard riskDistribution={classStats.riskDistribution} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {readyKeys.has('allEvents') ? (
                <ReasonDistCard items={classReasonDist} />
              ) : (
                <DashboardCardSkeleton />
              )}
              {readyKeys.has('ranking') ? (
                <RankingCard
                  items={filteredRanking}
                  onSelectStudent={(entityId) =>
                    navigate(`/students?entity_id=${encodeURIComponent(entityId)}`)
                  }
                />
              ) : (
                <DashboardCardSkeleton />
              )}
              {readyKeys.has('allEvents') ? (
                <PeriodSummaryCard data={classPeriodSummary} period={summary?.period} />
              ) : (
                <DashboardCardSkeleton />
              )}
            </div>
          </>
        )}

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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <TagsOverviewCard tagData={tagData} />
          <MaintenanceActionsCard onReplay={replayEvents} onExportHtml={exportHtmlDashboard} />
        </div>

        <MemoCard refreshKey={memoRefreshKey} />
      </div>
    </div>
  )
}
