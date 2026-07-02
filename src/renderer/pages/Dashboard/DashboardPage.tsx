// =============================================================
// 仪表盘页面 — ECharts 数据可视化 + 统计卡片
// =============================================================

import type {
  ClassEntity,
  EAADoctorData,
  EAAEventRecord,
  EAAInfoData,
  EAARankItem,
  EAAStatsData,
  EAASummaryData,
  EAAStudent,
  EAATagDetailData,
  EAATagListData,
  EAAValidateData,
} from '@shared/types'
import { BarChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../../hooks/useTheme'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

// MEDIUM 修复: 类型守卫,区分 EAATagListData 和 EAATagDetailData,避免不安全的 as 断言
function isTagListData(d: EAATagListData | EAATagDetailData): d is EAATagListData {
  return Array.isArray((d as EAATagListData).tags)
}

echarts.use([
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

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

// 渐变色配色方案
const GRADIENT_COLORS = {
  blue: {
    from: '#3b82f6',
    to: '#1d4ed8',
    bg: 'from-blue-500/10 to-blue-600/5',
    border: 'border-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
    shadow: 'shadow-blue-500/10',
  },
  green: {
    from: '#22c55e',
    to: '#15803d',
    bg: 'from-green-500/10 to-green-600/5',
    border: 'border-green-500/20',
    text: 'text-green-600 dark:text-green-400',
    shadow: 'shadow-green-500/10',
  },
  yellow: {
    from: '#eab308',
    to: '#a16207',
    bg: 'from-yellow-500/10 to-yellow-600/5',
    border: 'border-yellow-500/20',
    text: 'text-yellow-600 dark:text-yellow-400',
    shadow: 'shadow-yellow-500/10',
  },
  purple: {
    from: '#a855f7',
    to: '#7e22ce',
    bg: 'from-purple-500/10 to-purple-600/5',
    border: 'border-purple-500/20',
    text: 'text-purple-600 dark:text-purple-400',
    shadow: 'shadow-purple-500/10',
  },
  red: {
    from: '#ef4444',
    to: '#b91c1c',
    bg: 'from-red-500/10 to-red-600/5',
    border: 'border-red-500/20',
    text: 'text-red-600 dark:text-red-400',
    shadow: 'shadow-red-500/10',
  },
}

export function DashboardPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const [stats, setStats] = useState<EAAStatsData | null>(null)
  const [summary, setSummary] = useState<EAASummaryData | null>(null)
  const [ranking, setRanking] = useState<EAARankItem[]>([])
  const [allEvents, setAllEvents] = useState<EAAEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  // 系统管理 & 诊断
  const [eaaInfo, setEaaInfo] = useState<EAAInfoData | null>(null)
  const [doctorData, setDoctorData] = useState<EAADoctorData | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [validateData, setValidateData] = useState<EAAValidateData | null>(null)
  const [validateRunning, setValidateRunning] = useState(false)
  const [tagData, setTagData] = useState<EAATagListData | null>(null)
  // 班级筛选: 加载全量学生 + 班级列表, 支持按班级过滤排行/统计
  const [allStudents, setAllStudents] = useState<EAAStudent[]>([])
  const [classList, setClassList] = useState<ClassEntity[]>([])
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  const [compareMode, setCompareMode] = useState(false)
  const [compareClassA, setCompareClassA] = useState<string>('')
  const [compareClassB, setCompareClassB] = useState<string>('')
  const theme = useTheme()
  const isDark = theme === 'dark'
  const axisColor = isDark ? '#9ca3af' : '#6b7280'
  const gridColor = isDark ? '#1f2937' : '#e5e7eb'
  const labelColor = isDark ? '#d1d5db' : '#374151'
  const legendColor = isDark ? '#9ca3af' : '#6b7280'

  const loadData = useCallback(async () => {
    try {
      // 使用 allSettled: 单个 EAA 命令失败不阻塞其他数据加载
      // 例如 eaa.tag() 失败时,stats/ranking 仍能正常显示
      const results = await Promise.allSettled([
        getAPI().eaa.stats(),
        getAPI().eaa.summary(),
        getAPI().eaa.ranking(10),
        getAPI().eaa.info(),
        getAPI().eaa.tag(),
        getAPI().eaa.listStudents(),
        getAPI().class.list(),
        // 拉取半年内全局事件 (用于按班级过滤事件原因分布/周期摘要)
        getAPI().eaa.range(
          new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
          new Date().toISOString().slice(0, 10),
          5000,
        ),
      ])

      // 逐个处理结果,保持类型安全
      const statsRes = results[0]
      if (statsRes.status === 'fulfilled' && statsRes.value.success && statsRes.value.data) {
        setStats(statsRes.value.data)
      }

      const summaryRes = results[1]
      if (summaryRes.status === 'fulfilled' && summaryRes.value.success && summaryRes.value.data) {
        setSummary(summaryRes.value.data)
      }

      const rankingRes = results[2]
      if (
        rankingRes.status === 'fulfilled' &&
        rankingRes.value.success &&
        rankingRes.value.data?.ranking
      ) {
        setRanking(rankingRes.value.data.ranking)
      }

      const infoRes = results[3]
      if (infoRes.status === 'fulfilled' && infoRes.value.success && infoRes.value.data) {
        setEaaInfo(infoRes.value.data)
      }

      const tagRes = results[4]
      if (tagRes.status === 'fulfilled' && tagRes.value.success && tagRes.value.data) {
        // MEDIUM 修复: 用类型守卫替代 as 断言,确保 data 确实是 EAATagListData
        if (isTagListData(tagRes.value.data)) {
          setTagData(tagRes.value.data)
        }
      }

      // 加载全量学生列表 (用于按班级过滤排行/统计)
      // 过滤掉已删除学生 (status=Deleted),避免软删除学生干扰仪表盘统计
      const stuRes = results[5]
      if (stuRes.status === 'fulfilled' && stuRes.value.success && stuRes.value.data?.students) {
        setAllStudents(stuRes.value.data.students.filter((s) => s.status !== 'Deleted'))
      }

      // 加载班级列表
      const clsRes = results[6]
      if (clsRes.status === 'fulfilled' && clsRes.value.success && clsRes.value.data) {
        setClassList(clsRes.value.data)
      }

      // 加载全局事件 (用于按班级过滤事件原因分布/周期摘要)
      const rangeRes = results[7]
      if (rangeRes.status === 'fulfilled' && rangeRes.value.success && rangeRes.value.data?.events) {
        setAllEvents(rangeRes.value.data.events)
      }

      // 记录失败的部分到控制台,便于调试
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        console.warn(
          `[Dashboard] ${failed.length}/${results.length} EAA calls failed:`,
          failed.map((r) => String((r as PromiseRejectedResult).reason)),
        )
      }
    } catch (err) {
      console.error('[Dashboard] Failed to load:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadData()
  }, [loadData])

  // class_id → 班级名称 映射
  const classIdToName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of classList) m[c.class_id] = c.name
    return m
  }, [classList])

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
      highRisk: riskCount['极高'] + riskCount['高'],
      riskDistribution: riskCount,
    }
  }, [allStudents, classFilter])

  // 按班级过滤后的学生集合 (复用过滤逻辑,供分数分布/事件聚合使用)
  const filteredStudents = useMemo(() => {
    if (classFilter === '__ALL__') return allStudents
    if (classFilter === '__NONE__') return allStudents.filter((s) => !s.class_id)
    return allStudents.filter((s) => s.class_id === classFilter)
  }, [allStudents, classFilter])

  // 按班级过滤后的分数分布 (区间定义与 stats.score_intervals 保持一致)
  const classScoreIntervals = useMemo(() => {
    const buckets: Record<string, number> = {
      '极高(<60)': 0,
      '高(60-80)': 0,
      '中(80-100)': 0,
      '低(>=100)': 0,
    }
    for (const s of filteredStudents) {
      if (s.score < 60) buckets['极高(<60)']++
      else if (s.score < 80) buckets['高(60-80)']++
      else if (s.score < 100) buckets['中(80-100)']++
      else buckets['低(>=100)']++
    }
    return buckets
  }, [filteredStudents])

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

  // 按班级过滤后的事件原因分布
  const classReasonDist = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of filteredEvents) {
      const code = e.reason_code || 'UNKNOWN'
      counts[code] = (counts[code] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
  }, [filteredEvents])

  // 按班级过滤后的周期摘要 (事件计数 + top_gainers/losers)
  const classPeriodSummary = useMemo(() => {
    let bonusCount = 0
    let deductCount = 0
    let bonusTotal = 0
    let deductTotal = 0
    const deltaByEntity: Record<string, number> = {}
    for (const e of filteredEvents) {
      const d = e.score_delta
      if (d > 0) {
        bonusCount++
        bonusTotal += d
      } else if (d < 0) {
        deductCount++
        deductTotal += d
      }
      deltaByEntity[e.entity_id] = (deltaByEntity[e.entity_id] ?? 0) + d
    }
    const gainers = Object.entries(deltaByEntity)
      .filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([eid, d]) => ({ name: entityIdToName[eid] ?? eid, delta: d }))
    const losers = Object.entries(deltaByEntity)
      .filter(([, d]) => d < 0)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([eid, d]) => ({ name: entityIdToName[eid] ?? eid, delta: d }))
    return {
      events: {
        total: filteredEvents.length,
        bonus_count: bonusCount,
        deduct_count: deductCount,
        bonus_total: bonusTotal,
        deduct_total: deductTotal,
      },
      top_gainers: gainers,
      top_losers: losers,
    }
  }, [filteredEvents, entityIdToName])

  // 班级对比数据: 每个班级的学生数/平均分/高风险数
  const classComparison = useMemo(() => {
    return activeClassList.map((c) => {
      const students = allStudents.filter((s) => s.class_id === c.class_id)
      const riskCount = { 极高: 0, 高: 0, 中: 0, 低: 0 }
      let totalScore = 0
      for (const s of students) {
        riskCount[s.risk] = (riskCount[s.risk] ?? 0) + 1
        totalScore += s.score
      }
      return {
        classId: c.class_id,
        className: c.name,
        grade: c.grade ?? '-',
        teacher: c.teacher ?? '-',
        studentCount: students.length,
        avgScore: students.length > 0 ? totalScore / students.length : 0,
        highRisk: riskCount['极高'] + riskCount['高'],
        riskDistribution: riskCount,
      }
    })
  }, [activeClassList, allStudents])

  // 双班级对比数据
  const compareDataA = useMemo(() => {
    if (!compareClassA) return null
    return classComparison.find((c) => c.classId === compareClassA) ?? null
  }, [classComparison, compareClassA])
  const compareDataB = useMemo(() => {
    if (!compareClassB) return null
    return classComparison.find((c) => c.classId === compareClassB) ?? null
  }, [classComparison, compareClassB])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
        {t('common.loading')}
      </div>
    )
  }

  const s = stats?.summary
  // 分数分布: 使用按班级过滤后的 classScoreIntervals (而非全局 stats.score_intervals)
  const scoreIntervals = classScoreIntervals
  // 按风险等级排序：极高 → 高 → 中 → 低
  const SCORE_ORDER = ['极高(<60)', '高(60-80)', '中(80-100)', '低(>=100)']
  const sortedScoreKeys = SCORE_ORDER.filter((k) => k in scoreIntervals)

  return (
    <div className="h-full overflow-y-auto p-6 bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('page.dashboard.title')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('page.dashboard.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 班级筛选 */}
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            title="按班级筛选数据"
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
            className={`px-3 py-2 rounded-lg text-sm border transition-all ${
              compareMode
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="班级对比模式"
          >
            📊 班级对比
          </button>
          <button
            type="button"
            onClick={loadData}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700
                       px-4 py-2 rounded-lg text-sm transition-all duration-200 shadow-sm hover:shadow-md"
          >
            🔄 {t('page.dashboard.refresh')}
          </button>
        </div>
      </div>

      {/* 班级对比模式: 显示对比表格 */}
      {compareMode && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            班级对比总览
          </h3>
          {classComparison.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
              暂无班级数据
            </div>
          ) : (
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 px-3 font-medium">班级</th>
                  <th className="py-2 px-3 font-medium">年级</th>
                  <th className="py-2 px-3 font-medium">班主任</th>
                  <th className="py-2 px-3 font-medium text-center">学生数</th>
                  <th className="py-2 px-3 font-medium text-center">平均分</th>
                  <th className="py-2 px-3 font-medium text-center">高风险</th>
                  <th className="py-2 px-3 font-medium text-center">极高</th>
                  <th className="py-2 px-3 font-medium text-center">高</th>
                  <th className="py-2 px-3 font-medium text-center">中</th>
                  <th className="py-2 px-3 font-medium text-center">低</th>
                </tr>
              </thead>
              <tbody>
                {classComparison.map((c) => (
                  <tr key={c.classId} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2 px-3 font-medium">{c.className}</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{c.grade}</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{c.teacher}</td>
                    <td className="py-2 px-3 text-center font-mono">{c.studentCount}</td>
                    <td className="py-2 px-3 text-center font-mono">{c.avgScore.toFixed(1)}</td>
                    <td className={`py-2 px-3 text-center font-mono ${c.highRisk > 0 ? 'text-red-500 dark:text-red-400 font-bold' : ''}`}>{c.highRisk}</td>
                    <td className="py-2 px-3 text-center text-red-500 dark:text-red-400">{c.riskDistribution['极高']}</td>
                    <td className="py-2 px-3 text-center text-orange-500 dark:text-orange-400">{c.riskDistribution['高']}</td>
                    <td className="py-2 px-3 text-center text-yellow-500 dark:text-yellow-400">{c.riskDistribution['中']}</td>
                    <td className="py-2 px-3 text-center text-green-500 dark:text-green-400">{c.riskDistribution['低']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 双班级对比选择器 */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">双班级详细对比</h4>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={compareClassA}
                onChange={(e) => setCompareClassA(e.target.value)}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">选择班级 A...</option>
                {activeClassList.map((c) => (
                  <option key={c.id} value={c.class_id}>{c.name}</option>
                ))}
              </select>
              <span className="text-gray-400">VS</span>
              <select
                value={compareClassB}
                onChange={(e) => setCompareClassB(e.target.value)}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">选择班级 B...</option>
                {activeClassList.map((c) => (
                  <option key={c.id} value={c.class_id}>{c.name}</option>
                ))}
              </select>
            </div>
            {compareDataA && compareDataB && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                {[compareDataA, compareDataB].map((d, i) => (
                  <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                    <h5 className="font-semibold text-sm mb-2">{d.className}</h5>
                    <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <div className="flex justify-between"><span>学生数</span><span className="font-mono">{d.studentCount}</span></div>
                      <div className="flex justify-between"><span>平均分</span><span className="font-mono">{d.avgScore.toFixed(1)}</span></div>
                      <div className="flex justify-between"><span>高风险</span><span className={`font-mono ${d.highRisk > 0 ? 'text-red-500 font-bold' : ''}`}>{d.highRisk}</span></div>
                      <div className="flex justify-between"><span>极高</span><span className="font-mono text-red-500">{d.riskDistribution['极高']}</span></div>
                      <div className="flex justify-between"><span>高</span><span className="font-mono text-orange-500">{d.riskDistribution['高']}</span></div>
                      <div className="flex justify-between"><span>中</span><span className="font-mono text-yellow-500">{d.riskDistribution['中']}</span></div>
                      <div className="flex justify-between"><span>低</span><span className="font-mono text-green-500">{d.riskDistribution['低']}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 概览卡片 — 按班级筛选时显示班级数据 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          title={classFilter === '__ALL__' ? t('page.dashboard.stat.students') : '班级学生'}
          value={classStats.total}
          color="blue"
          icon="👥"
        />
        <StatCard
          title={t('page.dashboard.stat.events')}
          value={classPeriodSummary.events.total}
          color="green"
          icon="✅"
        />
        <StatCard
          title={t('page.dashboard.stat.revoked')}
          value={s?.reverted_events ?? 0}
          color="yellow"
          icon="↩️"
        />
        <StatCard
          title={t('page.dashboard.stat.scoreChange')}
          value={classFilter === '__ALL__' ? (s?.total_delta?.toFixed(1) ?? '-') : classStats.avgScore.toFixed(1)}
          color="purple"
          icon="📊"
        />
        <StatCard
          title={t('page.dashboard.stat.highRisk')}
          value={classStats.highRisk}
          color="red"
          icon="⚠️"
        />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 分数分布柱状图 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            {t('page.dashboard.chart.scoreDist')}
          </h3>
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 260 }}
            option={{
              animation: true,
              animationDuration: 800,
              animationEasing: 'cubicOut',
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
                axisLabel: { color: axisColor, fontSize: 11, rotate: 0 },
                axisLine: { lineStyle: { color: gridColor } },
                axisTick: { show: false },
              },
              yAxis: {
                type: 'value',
                axisLabel: { color: axisColor },
                splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
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
                    itemStyle: {
                      shadowBlur: 10,
                      shadowOffsetX: 0,
                      shadowColor: 'rgba(0,0,0,0.2)',
                    },
                  },
                },
              ],
            }}
          />
        </div>

        {/* 风险等级饼图 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            {t('page.dashboard.chart.riskDist')}
          </h3>
          {classStats.riskDistribution ? (
            <ReactEChartsCore
              echarts={echarts}
              style={{ height: 260 }}
              option={{
                animation: true,
                animationDuration: 1000,
                animationEasing: 'elasticOut',
                tooltip: {
                  trigger: 'item',
                  formatter: '{b}: {c} 人 ({d}%)',
                  backgroundColor: isDark ? '#1f2937' : '#fff',
                  borderColor: isDark ? '#374151' : '#e5e7eb',
                  textStyle: { color: isDark ? '#d1d5db' : '#374151' },
                },
                legend: {
                  bottom: 0,
                  textStyle: { color: legendColor, fontSize: 11 },
                },
                series: [
                  {
                    type: 'pie',
                    radius: ['45%', '70%'],
                    center: ['50%', '45%'],
                    label: { color: labelColor, fontSize: 11 },
                    emphasis: {
                      label: { fontSize: 14, fontWeight: 'bold' },
                      itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0,0,0,0.3)',
                      },
                    },
                    data: Object.entries(classStats.riskDistribution).map(([name, value]) => ({
                      name,
                      value,
                      itemStyle: {
                        color:
                          name === '极高'
                            ? '#ef4444'
                            : name === '高'
                              ? '#f97316'
                              : name === '中'
                                ? '#eab308'
                                : '#22c55e',
                      },
                    })),
                  },
                ],
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-[260px] text-gray-400 dark:text-gray-500 text-sm">
              暂无数据
            </div>
          )}
        </div>
      </div>

      {/* 下半部分 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* 原因码分布 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
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
                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
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
              <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-6">
                暂无数据
              </div>
            )}
          </div>
        </div>

        {/* 排行榜 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            {t('page.dashboard.chart.top10')}
          </h3>
          <div className="space-y-2">
            {filteredRanking.length === 0 ? (
              <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-6">
                暂无排行数据
              </div>
            ) : (
              filteredRanking.slice(0, 10).map((r) => (
                <button
                  type="button"
                  key={r.entity_id}
                  onClick={() => navigate(`/students?entity_id=${encodeURIComponent(r.entity_id)}`)}
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
                  <span className="font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded flex-shrink-0">
                    {(typeof r.score === 'number' ? r.score : 0).toFixed(1)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 周期摘要 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-pink-500"></span>
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
                  <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    🏆 进步最快
                  </div>
                  {classPeriodSummary.top_gainers.slice(0, 3).map((g) => (
                    <div
                      key={g.name}
                      className="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0 min-w-0"
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
                  <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    ⚠️ 退步最快
                  </div>
                  {classPeriodSummary.top_losers.slice(0, 3).map((l) => (
                    <div
                      key={l.name}
                      className="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0 min-w-0"
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
            <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-6">
              暂无数据
            </div>
          )}
        </div>
      </div>

      {/* 系统管理 & 诊断 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
          <h2 className="text-lg font-bold text-gray-700 dark:text-gray-200">
            {t('page.dashboard.sysmgmt.title')}
          </h2>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* EAA 系统信息 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
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
                <span className="font-mono text-gray-700 dark:text-gray-300">{eaaInfo.events}</span>
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
            <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-4">
              {t('page.dashboard.sysmgmt.noData')}
            </div>
          )}
        </div>

        {/* 健康检查 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
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
              className="text-xs px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-2">
              {t('page.dashboard.sysmgmt.noData')}
            </div>
          )}
        </div>

        {/* 数据验证 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
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
              className="text-xs px-3 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                    {t('page.dashboard.sysmgmt.validate.warnings')} ({validateData.warnings.length})
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
            <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-2">
              {t('page.dashboard.sysmgmt.noData')}
            </div>
          )}
        </div>
      </div>

      {/* 标签概览 + 操作按钮区 */}
      <div className="grid grid-cols-3 gap-6 mt-6">
        {/* 标签概览 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            {t('page.dashboard.sysmgmt.tags')}
          </h3>
          {tagData && tagData.tags.length > 0 ? (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {tagData.tags.map((item) => (
                <div key={item.tag} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 dark:text-gray-300 font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                    {item.tag}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 font-mono">{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-4">
              {t('page.dashboard.sysmgmt.noData')}
            </div>
          )}
        </div>

        {/* 操作按钮区 */}
        <div className="col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
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
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors"
              >
                🔄 {t('page.dashboard.sysmgmt.replay')}
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
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-600 text-white transition-colors"
              >
                📊 导出 HTML 仪表盘
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// 统计卡片组件 — 渐变色 + 阴影 + hover 效果
// =============================================================

function StatCard({
  title,
  value,
  color,
  icon,
}: {
  title: string
  value: string | number
  color: string
  icon: string
}) {
  const c = GRADIENT_COLORS[color as keyof typeof GRADIENT_COLORS] ?? GRADIENT_COLORS.blue
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${c.border} bg-gradient-to-br ${c.bg}
                  p-5 shadow-lg ${c.shadow} hover:shadow-xl hover:-translate-y-0.5
                  transition-all duration-300 cursor-default group`}
    >
      {/* 装饰性渐变圆 */}
      <div
        className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
      />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{title}</span>
          <span className="text-lg">{icon}</span>
        </div>
        <div className={`text-3xl font-bold ${c.text}`}>{value}</div>
        <div
          className="mt-2 h-1 rounded-full w-0 group-hover:w-full transition-all duration-500"
          style={{ background: `linear-gradient(90deg, ${c.from}, ${c.to})` }}
        />
      </div>
    </div>
  )
}
