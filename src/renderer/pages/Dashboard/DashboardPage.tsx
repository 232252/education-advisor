// =============================================================
// 仪表盘页面 — ECharts 数据可视化 + 统计卡片
// =============================================================

import type { EAADoctorData, EAAStudent, EAAValidateData } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileOutput,
  GraduationCap,
  Inbox,
  RefreshCw,
  Tags,
  Trophy,
  Undo2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/Skeleton'
import { useChartTheme } from '../../hooks/useChartTheme'
import { useTheme } from '../../hooks/useTheme'
import { useT } from '../../i18n'
import { echarts } from '../../lib/echarts-setup'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE, TABLE_ROW, TABLE_TD, TABLE_TH } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { DashboardStatCard } from './components/DashboardStatCard'
import {
  computeClassComparison,
  computePeriodSummary,
  computeReasonDistribution,
  computeScoreIntervals,
} from './dashboard-stats'
import { useDashboardData } from './hooks/useDashboardData'

// 原因码 → 中文标签映射
const REASON_CODE_LABELS: Record<string, string> = {
  SPEAK_IN_CLASS: '课堂讲话',
  SLEEP_IN_CLASS: '课堂睡觉',
  LATE: '迟到',
  SCHOOL_CAUGHT: '学校抓拍违纪',
  MAKEUP: '补差扣分',
  DESK_UNALIGNED: '桌椅不整齐',
  PHONE_IN_CLASS: '手机违纪',
  SMOKING: '抽烟',
  DRINKING_DORM: '寝室饮酒',
  OTHER_DEDUCT: '其他扣分',
  APPEARANCE_VIOLATION: '仪容仪表违纪',
  BONUS_VARIABLE: '学业奖励(变量)',
  ACTIVITY_PARTICIPATION: '活动参与加分',
  CLASS_MONITOR: '班长履职加分',
  CLASS_COMMITTEE: '班委履职加分',
  CIVILIZED_DORM: '文明寝室',
  MONTHLY_ATTENDANCE: '月勤奖励',
  REVERT: '撤销(自动计算)',
  LAB_EQUIPMENT_DAMAGE: '实验室设备损坏',
  LAB_SAFETY_VIOLATION: '实验室安全违规',
  LAB_UNSAFE_BEHAVIOR: '实验室不安全行为',
  LAB_CLEAN_UP: '实验室未清理',
}

// 分数分布排序: 极高 → 高 → 中 → 低
const SCORE_ORDER = ['极高(<60)', '高(60-80)', '中(80-100)', '低(>=100)']

// 颜色辅助：按风险等级取色（模块级常量化，避免 render 中重复三元判断）
const riskColorOf = (name: string) =>
  name === '极高' ? '#ef4444' : name === '高' ? '#f97316' : name === '中' ? '#eab308' : '#22c55e'

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
  // 系统管理 & 诊断（仅本页使用的局部状态）
  const [doctorData, setDoctorData] = useState<EAADoctorData | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [validateData, setValidateData] = useState<EAAValidateData | null>(null)
  const [validateRunning, setValidateRunning] = useState(false)
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  const [compareMode, setCompareMode] = useState(false)
  const [compareClassA, setCompareClassA] = useState<string>('')
  const [compareClassB, setCompareClassB] = useState<string>('')
  const theme = useTheme()
  const isDark = theme === 'dark'
  const chartTheme = useChartTheme()

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

  // 活跃班级列表
  const activeClassList = useMemo(() => classList.filter((c) => !c.archived), [classList])

  // entity_id → class_id 映射 (用于过滤排行)
  const entityIdToClassId = useMemo(() => {
    const m: Record<string, string | null> = {}
    for (const s of allStudents) m[s.entity_id] = s.class_id
    return m
  }, [allStudents])

  // 按班级过滤后的排行 (取前10)
  const filteredRanking = useMemo(() => {
    if (classFilter === '__ALL__') return ranking
    return ranking.filter((r) => {
      const cid = entityIdToClassId[r.entity_id]
      if (classFilter === '__NONE__') return !cid
      return cid === classFilter
    })
  }, [ranking, classFilter, entityIdToClassId])

  // 按班级过滤后的学生统计
  const classStats = useMemo(() => {
    let students: EAAStudent[]
    if (classFilter === '__ALL__') {
      students = allStudents
    } else if (classFilter === '__NONE__') {
      students = allStudents.filter((s) => !s.class_id)
    } else {
      students = allStudents.filter((s) => s.class_id === classFilter)
    }
    const riskCount = { 极高: 0, 高: 0, 中: 0, 低: 0 }
    let totalScore = 0
    for (const s of students) {
      riskCount[s.risk] = (riskCount[s.risk] ?? 0) + 1
      totalScore += s.score
    }
    return {
      total: students.length,
      avgScore: students.length > 0 ? totalScore / students.length : 0,
      highRisk: riskCount.极高 + riskCount.高,
      riskDistribution: riskCount,
    }
  }, [allStudents, classFilter])

  // 按班级过滤后的学生集合 (复用过滤逻辑,供分数分布/事件聚合使用)
  const filteredStudents = useMemo(() => {
    if (classFilter === '__ALL__') return allStudents
    if (classFilter === '__NONE__') return allStudents.filter((s) => !s.class_id)
    return allStudents.filter((s) => s.class_id === classFilter)
  }, [allStudents, classFilter])

  // 按班级过滤后的分数分布（逻辑提取到 dashboard-stats.ts）
  const classScoreIntervals = useMemo(
    () => computeScoreIntervals(filteredStudents),
    [filteredStudents],
  )

  // 按班级过滤后的事件集合 (基于 entityIdToClassId 映射)
  const filteredEvents = useMemo(() => {
    if (classFilter === '__ALL__') return allEvents
    return allEvents.filter((e) => {
      const cid = entityIdToClassId[e.entity_id]
      if (classFilter === '__NONE__') return !cid
      return cid === classFilter
    })
  }, [allEvents, classFilter, entityIdToClassId])

  // entity_id → name 映射 (用于周期摘要 top_gainers/losers 显示学生名)
  const entityIdToName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of allStudents) m[s.entity_id] = s.name
    return m
  }, [allStudents])

  // 按班级过滤后的事件原因分布（逻辑提取到 dashboard-stats.ts）
  const classReasonDist = useMemo(() => computeReasonDistribution(filteredEvents), [filteredEvents])

  // 按班级过滤后的周期摘要 (事件计数 + top_gainers/losers，逻辑提取到 dashboard-stats.ts)
  const classPeriodSummary = useMemo(
    () => computePeriodSummary(filteredEvents, entityIdToName),
    [filteredEvents, entityIdToName],
  )

  // 班级对比数据: 每个班级的学生数/平均分/高风险数（逻辑提取到 dashboard-stats.ts）
  const classComparison = useMemo(
    () =>
      computeClassComparison(activeClassList, allStudents).map((c) => {
        const cls = activeClassList.find((x) => x.class_id === c.classId)
        return {
          ...c,
          grade: cls?.grade ?? '-',
          teacher: cls?.teacher ?? '-',
        }
      }),
    [activeClassList, allStudents],
  )

  // 双班级对比数据
  const compareDataA = useMemo(() => {
    if (!compareClassA) return null
    return classComparison.find((c) => c.classId === compareClassA) ?? null
  }, [classComparison, compareClassA])
  const compareDataB = useMemo(() => {
    if (!compareClassB) return null
    return classComparison.find((c) => c.classId === compareClassB) ?? null
  }, [classComparison, compareClassB])

  // 分数分布: 使用按班级过滤后的 classScoreIntervals (而非全局 stats.score_intervals)
  const scoreIntervals = classScoreIntervals
  // 按风险等级排序：极高 → 高 → 中 → 低 (SCORE_ORDER 已提升为模块常量)
  const sortedScoreKeys = useMemo(
    () => SCORE_ORDER.filter((k) => k in scoreIntervals),
    [scoreIntervals],
  )

  // ECharts option memo 化 — 避免每次渲染重建大对象触发 echarts 重绘
  // 注意: 必须在 if (loading) return 之前调用, 以遵守 React Hooks 规则
  const scoreChartOption = useMemo(
    () => ({
      animation: true,
      animationDuration: 800,
      animationEasing: 'cubicOut' as const,
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#1f2937' : '#fff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        textStyle: { color: isDark ? '#d1d5db' : '#374151' },
      },
      grid: { left: 8, right: 8, top: 8, bottom: 28, containLabel: true },
      xAxis: {
        type: 'category',
        data: sortedScoreKeys,
        axisLabel: { color: chartTheme.legendColor, fontSize: 11, rotate: 0 },
        axisLine: { lineStyle: { color: chartTheme.gridColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: chartTheme.legendColor },
        splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
      },
      series: [
        {
          type: 'bar',
          data: Object.entries(scoreIntervals).map(([label, count]) => ({
            value: count,
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                {
                  offset: 0,
                  color: label.includes('极高')
                    ? '#ef4444'
                    : label.includes('低')
                      ? '#f97316'
                      : label.includes('中')
                        ? '#eab308'
                        : '#22c55e',
                },
                {
                  offset: 1,
                  color: label.includes('极高')
                    ? '#dc2626'
                    : label.includes('低')
                      ? '#ea580c'
                      : label.includes('中')
                        ? '#ca8a04'
                        : '#16a34a',
                },
              ]),
            },
          })),
          barWidth: '50%',
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' },
          },
        },
      ],
    }),
    [scoreIntervals, sortedScoreKeys, isDark, chartTheme],
  )

  const riskChartOption = useMemo(
    () => ({
      animation: true,
      animationDuration: 1000,
      animationEasing: 'elasticOut' as const,
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} 人 ({d}%)',
        backgroundColor: isDark ? '#1f2937' : '#fff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        textStyle: { color: isDark ? '#d1d5db' : '#374151' },
      },
      legend: { bottom: 0, textStyle: { color: chartTheme.legendColor, fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          label: { color: chartTheme.axisLabelColor, fontSize: 11 },
          emphasis: {
            label: { fontSize: 14, fontWeight: 'bold' },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.3)' },
          },
          data: classStats.riskDistribution
            ? Object.entries(classStats.riskDistribution).map(([name, value]) => ({
                name,
                value,
                itemStyle: { color: riskColorOf(name) },
              }))
            : [],
        },
      ],
    }),
    [classStats.riskDistribution, isDark, chartTheme],
  )

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
          <>
            {/* 班级筛选 */}
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className={INPUT_BASE}
              title="按班级筛选数据"
              aria-label="按班级筛选数据"
            >
              <option value="__ALL__">全部班级</option>
              <option value="__NONE__">未分班</option>
              {activeClassList.map((c) => (
                <option key={c.id} value={c.class_id}>
                  {c.name}
                </option>
              ))}
            </select>
            {/* 班级对比模式开关 */}
            <button
              type="button"
              onClick={() => setCompareMode(!compareMode)}
              className={btnStyle(compareMode ? 'primary' : 'secondary')}
              title="班级对比模式"
              aria-label="班级对比模式"
            >
              班级对比
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className={btnStyle('ghost')}
              aria-label="刷新数据"
            >
              {t('page.dashboard.refresh')}
            </button>
          </>
        }
      />
      <div className="p-6 space-y-6">
        {/* 班级对比模式: 显示对比表格 */}
        {compareMode && (
          <Card padding="md" className="shadow-card animate-slide-up overflow-x-auto">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
              班级对比总览
            </h3>
            {classComparison.length === 0 ? (
              <EmptyState
                icon={<GraduationCap size={28} />}
                title="暂无班级数据"
                className="py-6"
              />
            ) : (
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr>
                    <th className={TABLE_TH}>班级</th>
                    <th className={TABLE_TH}>年级</th>
                    <th className={TABLE_TH}>班主任</th>
                    <th className={cn(TABLE_TH, 'text-center')}>学生数</th>
                    <th className={cn(TABLE_TH, 'text-center')}>平均分</th>
                    <th className={cn(TABLE_TH, 'text-center')}>高风险</th>
                    <th className={cn(TABLE_TH, 'text-center')}>极高</th>
                    <th className={cn(TABLE_TH, 'text-center')}>高</th>
                    <th className={cn(TABLE_TH, 'text-center')}>中</th>
                    <th className={cn(TABLE_TH, 'text-center')}>低</th>
                  </tr>
                </thead>
                <tbody>
                  {classComparison.map((c) => (
                    <tr key={c.classId} className={TABLE_ROW}>
                      <td className={cn(TABLE_TD, 'font-medium')}>{c.className}</td>
                      <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>
                        {c.grade}
                      </td>
                      <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>
                        {c.teacher}
                      </td>
                      <td className={cn(TABLE_TD, 'text-center font-mono')}>{c.studentCount}</td>
                      <td className={cn(TABLE_TD, 'text-center font-mono')}>
                        {c.avgScore.toFixed(1)}
                      </td>
                      <td
                        className={cn(
                          TABLE_TD,
                          'text-center font-mono',
                          c.highRisk > 0 && 'text-red-500 dark:text-red-400 font-bold',
                        )}
                      >
                        {c.highRisk}
                      </td>
                      <td className={cn(TABLE_TD, 'text-center text-red-500 dark:text-red-400')}>
                        {c.riskDistribution.极高}
                      </td>
                      <td
                        className={cn(TABLE_TD, 'text-center text-orange-500 dark:text-orange-400')}
                      >
                        {c.riskDistribution.高}
                      </td>
                      <td
                        className={cn(TABLE_TD, 'text-center text-yellow-500 dark:text-yellow-400')}
                      >
                        {c.riskDistribution.中}
                      </td>
                      <td
                        className={cn(TABLE_TD, 'text-center text-green-500 dark:text-green-400')}
                      >
                        {c.riskDistribution.低}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 双班级对比选择器 */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/[0.06]">
              <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                双班级详细对比
              </h4>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={compareClassA}
                  onChange={(e) => setCompareClassA(e.target.value)}
                  className={INPUT_BASE}
                  aria-label="选择对比班级 A"
                >
                  <option value="">选择班级 A...</option>
                  {activeClassList.map((c) => (
                    <option key={c.id} value={c.class_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="text-gray-400 dark:text-gray-500 text-xs font-medium">VS</span>
                <select
                  value={compareClassB}
                  onChange={(e) => setCompareClassB(e.target.value)}
                  className={INPUT_BASE}
                  aria-label="选择对比班级 B"
                >
                  <option value="">选择班级 B...</option>
                  {activeClassList.map((c) => (
                    <option key={c.id} value={c.class_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {compareDataA && compareDataB && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[compareDataA, compareDataB].map((d) => (
                    <div
                      key={d.className}
                      className="bg-gray-50/80 dark:bg-white/[0.03] rounded-xl p-4 border border-gray-100 dark:border-white/[0.06]"
                    >
                      <h5 className="font-semibold text-sm mb-2">{d.className}</h5>
                      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                        <div className="flex justify-between">
                          <span>学生数</span>
                          <span className="font-mono">{d.studentCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>平均分</span>
                          <span className="font-mono">{d.avgScore.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>高风险</span>
                          <span
                            className={`font-mono ${d.highRisk > 0 ? 'text-red-500 font-bold' : ''}`}
                          >
                            {d.highRisk}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>极高</span>
                          <span className="font-mono text-red-500">{d.riskDistribution.极高}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>高</span>
                          <span className="font-mono text-orange-500">{d.riskDistribution.高}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>中</span>
                          <span className="font-mono text-yellow-500">{d.riskDistribution.中}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>低</span>
                          <span className="font-mono text-green-500">{d.riskDistribution.低}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* 概览卡片 — 按班级筛选时显示班级数据 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <DashboardStatCard
            title={classFilter === '__ALL__' ? t('page.dashboard.stat.students') : '班级学生'}
            value={classStats.total}
            color="blue"
            icon={Users}
            className="animate-slide-up stagger-1"
          />
          <DashboardStatCard
            title={t('page.dashboard.stat.events')}
            value={classPeriodSummary.events.total}
            color="green"
            icon={CheckCircle2}
            className="animate-slide-up stagger-2"
          />
          <DashboardStatCard
            title={t('page.dashboard.stat.revoked')}
            value={s?.reverted_events ?? 0}
            color="yellow"
            icon={Undo2}
            className="animate-slide-up stagger-3"
          />
          <DashboardStatCard
            title={t('page.dashboard.stat.scoreChange')}
            value={
              classFilter === '__ALL__'
                ? (s?.total_delta?.toFixed(1) ?? '-')
                : classStats.avgScore.toFixed(1)
            }
            color="purple"
            icon={BarChart3}
            className="animate-slide-up stagger-4"
          />
          <DashboardStatCard
            title={t('page.dashboard.stat.highRisk')}
            value={classStats.highRisk}
            color="red"
            icon={AlertTriangle}
            className="animate-slide-up stagger-5"
          />
        </div>

        {/* 图表区 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 分数分布柱状图 */}
          <Card
            padding="md"
            className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              {t('page.dashboard.chart.scoreDist')}
            </h3>
            <ReactEChartsCore echarts={echarts} style={{ height: 260 }} option={scoreChartOption} />
          </Card>

          {/* 风险等级饼图 */}
          <Card
            padding="md"
            className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
              {t('page.dashboard.chart.riskDist')}
            </h3>
            {classStats.riskDistribution ? (
              <ReactEChartsCore
                echarts={echarts}
                style={{ height: 260 }}
                option={riskChartOption}
              />
            ) : (
              <EmptyState icon={<BarChart3 size={28} />} title="暂无数据" className="py-6" />
            )}
          </Card>
        </div>

        {/* 下半部分 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 原因码分布 */}
          <Card
            padding="md"
            className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {t('page.dashboard.chart.eventReason')}
            </h3>
            <div className="space-y-2">
              {classReasonDist?.slice(0, 8).map((item, idx) => (
                <div key={item.code} className="flex items-center gap-2 text-xs group">
                  <span
                    className="text-gray-600 dark:text-gray-300 min-w-[5rem] truncate"
                    title={item.code || ''}
                  >
                    {(REASON_CODE_LABELS[item.code || ''] ?? item.code) || '未知'}
                  </span>
                  <div className="flex-1 h-2 bg-gray-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 group-hover:opacity-80"
                      style={{
                        width: `${Math.min(100, (item.count / (classReasonDist[0]?.count ?? 1)) * 100)}%`,
                        background: `linear-gradient(90deg, ${['#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ef4444', '#06b6d4', '#f97316', '#ec4899'][idx]}, ${['#1d4ed8', '#15803d', '#a16207', '#7e22ce', '#b91c1c', '#0891b2', '#ea580c', '#db2777'][idx]})`,
                      }}
                    />
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 w-8 text-right font-mono flex-shrink-0">
                    {item.count}
                  </span>
                </div>
              )) ?? (
                <EmptyState icon={<ClipboardList size={28} />} title="暂无数据" className="py-6" />
              )}
            </div>
          </Card>

          {/* 排行榜 */}
          <Card
            padding="md"
            className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
              {t('page.dashboard.chart.top10')}
            </h3>
            <div className="space-y-2">
              {filteredRanking.length === 0 ? (
                <EmptyState icon={<Trophy size={28} />} title="暂无排行数据" className="py-6" />
              ) : (
                filteredRanking.slice(0, 10).map((r) => (
                  <button
                    type="button"
                    key={r.entity_id}
                    onClick={() =>
                      navigate(`/students?entity_id=${encodeURIComponent(r.entity_id)}`)
                    }
                    title={`${r.name} · ${(typeof r.score === 'number' ? r.score : 0).toFixed(1)}`}
                    className="w-full text-left flex items-center justify-between gap-2 text-xs p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer bg-transparent border-0 min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold
                    ${
                      r.rank === 1
                        ? 'bg-yellow-400 text-white shadow-lg shadow-yellow-400/30'
                        : r.rank === 2
                          ? 'bg-gray-300 text-gray-700 shadow-md'
                          : r.rank === 3
                            ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                      >
                        {r.rank}
                      </span>
                      <span className="text-gray-700 dark:text-gray-200 font-medium truncate min-w-0">
                        {r.name}
                      </span>
                    </div>
                    <span className="font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 rounded flex-shrink-0">
                      {(typeof r.score === 'number' ? r.score : 0).toFixed(1)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Card>

          {/* 周期摘要 */}
          <Card
            padding="md"
            className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500"></span>
              周期摘要
              {summary?.period?.since && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal ml-1">
                  {summary.period.since} ~ {summary.period.until ?? '至今'}
                </span>
              )}
            </h3>
            {classPeriodSummary ? (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-3 border border-green-200/50 dark:border-green-700/30">
                    <div className="text-gray-400 dark:text-gray-500">
                      {t('page.dashboard.summary.up')}
                    </div>
                    <div className="text-green-600 dark:text-green-400 font-bold text-lg">
                      {classPeriodSummary.events.bonus_count}
                    </div>
                    <div className="text-green-500/70 dark:text-green-400/70">
                      +{classPeriodSummary.events.bonus_total.toFixed(1)}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 rounded-xl p-3 border border-red-200/50 dark:border-red-700/30">
                    <div className="text-gray-400 dark:text-gray-500">
                      {t('page.dashboard.summary.down')}
                    </div>
                    <div className="text-red-600 dark:text-red-400 font-bold text-lg">
                      {classPeriodSummary.events.deduct_count}
                    </div>
                    <div className="text-red-500/70 dark:text-red-400/70">
                      {classPeriodSummary.events.deduct_total.toFixed(1)}
                    </div>
                  </div>
                </div>
                {classPeriodSummary.top_gainers.length > 0 && (
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium flex items-center gap-1.5">
                      <Trophy size={16} className="text-yellow-500" /> 进步最快
                    </div>
                    {classPeriodSummary.top_gainers.slice(0, 3).map((g) => (
                      <div
                        key={g.name}
                        className="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-white/[0.04] last:border-0 min-w-0"
                      >
                        <span className="text-gray-600 dark:text-gray-300 truncate min-w-0 flex-1">
                          {g.name}
                        </span>
                        <span className="text-green-500 dark:text-green-400 font-mono font-medium flex-shrink-0">
                          +{g.delta.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {classPeriodSummary.top_losers.length > 0 && (
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium flex items-center gap-1.5">
                      <AlertTriangle size={16} className="text-red-400" /> 退步最快
                    </div>
                    {classPeriodSummary.top_losers.slice(0, 3).map((l) => (
                      <div
                        key={l.name}
                        className="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-white/[0.04] last:border-0 min-w-0"
                      >
                        <span className="text-gray-600 dark:text-gray-300 truncate min-w-0 flex-1">
                          {l.name}
                        </span>
                        <span className="text-red-500 dark:text-red-400 font-mono font-medium flex-shrink-0">
                          {l.delta.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState icon={<Calendar size={28} />} title="暂无数据" className="py-6" />
            )}
          </Card>
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
          {/* EAA 系统信息 */}
          <Card padding="md" className="shadow-card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              {t('page.dashboard.sysmgmt.info')}
            </h3>
            {eaaInfo ? (
              <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>{t('page.dashboard.sysmgmt.info.version')}</span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">
                    {eaaInfo.version}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t('page.dashboard.sysmgmt.info.students')}</span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">
                    {eaaInfo.students}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t('page.dashboard.sysmgmt.info.events')}</span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">
                    {eaaInfo.events}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t('page.dashboard.sysmgmt.info.dataDir')}</span>
                  <span
                    className="font-mono text-gray-700 dark:text-gray-300 truncate ml-2"
                    title={eaaInfo.data_dir}
                  >
                    {eaaInfo.data_dir}
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Inbox size={28} />}
                title={t('page.dashboard.sysmgmt.noData')}
                className="py-4"
              />
            )}
          </Card>

          {/* 健康检查 */}
          <Card padding="md" className="shadow-card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {t('page.dashboard.sysmgmt.doctor')}
            </h3>
            <div className="mb-3">
              <button
                type="button"
                onClick={async () => {
                  setDoctorRunning(true)
                  try {
                    const res = await getAPI().eaa.doctor()
                    if (res.success && res.data) setDoctorData(res.data)
                    else toast.error(t('error.unknown'))
                  } catch {
                    toast.error(t('error.unknown'))
                  } finally {
                    setDoctorRunning(false)
                  }
                }}
                disabled={doctorRunning}
                className={btnStyle('primary')}
                aria-label={t('page.dashboard.sysmgmt.doctor.run')}
              >
                {doctorRunning
                  ? t('page.dashboard.sysmgmt.doctor.running')
                  : t('page.dashboard.sysmgmt.doctor.run')}
              </button>
            </div>
            {doctorData ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${doctorData.healthy ? 'bg-green-500' : 'bg-red-500'}`}
                  ></span>
                  <span
                    className={
                      doctorData.healthy
                        ? 'text-green-600 dark:text-green-400 font-medium'
                        : 'text-red-600 dark:text-red-400 font-medium'
                    }
                  >
                    {doctorData.healthy
                      ? t('page.dashboard.sysmgmt.doctor.healthy')
                      : t('page.dashboard.sysmgmt.doctor.unhealthy')}
                  </span>
                </div>
                <div className="flex gap-3 text-gray-500 dark:text-gray-400">
                  <span>
                    {t('page.dashboard.sysmgmt.doctor.passed')}:{' '}
                    <span className="font-mono text-green-600 dark:text-green-400">
                      {doctorData.passed}
                    </span>
                  </span>
                  <span>
                    {t('page.dashboard.sysmgmt.doctor.failed')}:{' '}
                    <span className="font-mono text-red-600 dark:text-red-400">
                      {doctorData.failed}
                    </span>
                  </span>
                </div>
                {doctorData.issues.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {doctorData.issues.map((issue) => (
                      <div
                        key={issue}
                        className="text-red-500 dark:text-red-400 truncate"
                        title={issue}
                      >
                        • {issue}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Inbox size={28} />}
                title={t('page.dashboard.sysmgmt.noData')}
                className="py-4"
              />
            )}
          </Card>

          {/* 数据验证 */}
          <Card padding="md" className="shadow-card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
              {t('page.dashboard.sysmgmt.validate')}
            </h3>
            <div className="mb-3">
              <button
                type="button"
                onClick={async () => {
                  setValidateRunning(true)
                  try {
                    const res = await getAPI().eaa.validate()
                    if (res.success && res.data) setValidateData(res.data)
                    else toast.error(t('error.unknown'))
                  } catch {
                    toast.error(t('error.unknown'))
                  } finally {
                    setValidateRunning(false)
                  }
                }}
                disabled={validateRunning}
                className={btnStyle('primary')}
                aria-label={t('page.dashboard.sysmgmt.validate.run')}
              >
                {validateRunning
                  ? t('page.dashboard.sysmgmt.validate.running')
                  : t('page.dashboard.sysmgmt.validate.run')}
              </button>
            </div>
            {validateData ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${validateData.valid ? 'bg-green-500' : 'bg-red-500'}`}
                  ></span>
                  <span
                    className={
                      validateData.valid
                        ? 'text-green-600 dark:text-green-400 font-medium'
                        : 'text-red-600 dark:text-red-400 font-medium'
                    }
                  >
                    {validateData.valid
                      ? t('page.dashboard.sysmgmt.validate.valid')
                      : t('page.dashboard.sysmgmt.validate.invalid')}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 ml-auto">
                    {validateData.total_events} events
                  </span>
                </div>
                {validateData.errors.length > 0 && (
                  <div>
                    <div className="text-red-500 dark:text-red-400 font-medium mb-0.5">
                      {t('page.dashboard.sysmgmt.validate.errors')} ({validateData.errors.length})
                    </div>
                    {validateData.errors.slice(0, 3).map((e) => (
                      <div key={e} className="text-red-400 dark:text-red-500 truncate" title={e}>
                        • {e}
                      </div>
                    ))}
                  </div>
                )}
                {validateData.warnings.length > 0 && (
                  <div>
                    <div className="text-yellow-500 dark:text-yellow-400 font-medium mb-0.5">
                      {t('page.dashboard.sysmgmt.validate.warnings')} (
                      {validateData.warnings.length})
                    </div>
                    {validateData.warnings.slice(0, 3).map((w) => (
                      <div
                        key={w}
                        className="text-yellow-400 dark:text-yellow-500 truncate"
                        title={w}
                      >
                        • {w}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Inbox size={28} />}
                title={t('page.dashboard.sysmgmt.noData')}
                className="py-4"
              />
            )}
          </Card>
        </div>

        {/* 标签概览 + 操作按钮区 */}
        <div className="grid grid-cols-3 gap-6">
          {/* 标签概览 */}
          <Card padding="md" className="shadow-card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
              {t('page.dashboard.sysmgmt.tags')}
            </h3>
            {tagData && tagData.tags.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {tagData.tags.map((item) => (
                  <div key={item.tag} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-300 font-mono bg-gray-100 dark:bg-white/[0.06] px-1.5 py-0.5 rounded">
                      {item.tag}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 font-mono">{item.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Tags size={28} />}
                title={t('page.dashboard.sysmgmt.noData')}
                className="py-4"
              />
            )}
          </Card>

          {/* 操作按钮区 */}
          <Card padding="md" className="col-span-2 shadow-card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
              {t('common.action', '维护工具')}
            </h3>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await getAPI().eaa.replay()
                      if (res.success) toast.success(t('page.dashboard.sysmgmt.replay.success'))
                      else toast.error(t('error.unknown'))
                    } catch {
                      toast.error(t('error.unknown'))
                    }
                  }}
                  className={btnStyle('primary')}
                  aria-label={t('page.dashboard.sysmgmt.replay')}
                >
                  <RefreshCw size={16} strokeWidth={2} /> {t('page.dashboard.sysmgmt.replay')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await getAPI().eaa.dashboard()
                      if (res.success)
                        toast.success(
                          res.data
                            ? `HTML 仪表盘已生成: ${res.data}`
                            : t('page.dashboard.sysmgmt.dashboard.success'),
                        )
                      else toast.error(res.stderr || t('error.unknown'))
                    } catch {
                      toast.error(t('error.unknown'))
                    }
                  }}
                  className={btnStyle('secondary')}
                  aria-label="导出 HTML 仪表盘"
                >
                  <FileOutput size={16} strokeWidth={2} /> 导出 HTML 仪表盘
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
