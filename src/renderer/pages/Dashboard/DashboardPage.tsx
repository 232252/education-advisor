// =============================================================
// 仪表盘页面 — ECharts 数据可视化 + 统计卡片
// =============================================================

import type {
  EAADoctorData,
  EAAInfoData,
  EAARankItem,
  EAAStatsData,
  EAASummaryData,
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
import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

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
  const [stats, setStats] = useState<EAAStatsData | null>(null)
  const [summary, setSummary] = useState<EAASummaryData | null>(null)
  const [ranking, setRanking] = useState<EAARankItem[]>([])
  const [loading, setLoading] = useState(true)
  // 系统管理 & 诊断
  const [eaaInfo, setEaaInfo] = useState<EAAInfoData | null>(null)
  const [doctorData, setDoctorData] = useState<EAADoctorData | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [validateData, setValidateData] = useState<EAAValidateData | null>(null)
  const [validateRunning, setValidateRunning] = useState(false)
  const [tagData, setTagData] = useState<EAATagListData | null>(null)
  const theme = useTheme()
  const isDark = theme === 'dark'
  const axisColor = isDark ? '#9ca3af' : '#6b7280'
  const gridColor = isDark ? '#1f2937' : '#e5e7eb'
  const labelColor = isDark ? '#d1d5db' : '#374151'
  const legendColor = isDark ? '#9ca3af' : '#6b7280'

  const loadData = useCallback(async () => {
    try {
      const [statsRes, summaryRes, rankingRes, infoRes, tagRes] = await Promise.all([
        getAPI().eaa.stats(),
        getAPI().eaa.summary(),
        getAPI().eaa.ranking(10),
        getAPI().eaa.info(),
        getAPI().eaa.tag(),
      ])
      if (statsRes.success && statsRes.data) setStats(statsRes.data)
      if (summaryRes.success && summaryRes.data) setSummary(summaryRes.data)
      if (rankingRes.success && rankingRes.data?.ranking) setRanking(rankingRes.data.ranking)
      if (infoRes.success && infoRes.data) setEaaInfo(infoRes.data)
      if (tagRes.success && tagRes.data) setTagData(tagRes.data as EAATagListData)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
        {t('common.loading')}
      </div>
    )
  }

  const s = stats?.summary
  const scoreIntervals = stats?.score_intervals ?? {}
  // 按风险等级排序：极高 → 高 → 中 → 低
  const SCORE_ORDER = ['极高(<60)', '高(60-80)', '中(80-100)', '低(>=100)']
  // 后端返回中文键名，用 i18n 映射翻译（仅对英文模式生效）
  const sortedScoreKeys = SCORE_ORDER.filter((k) => k in scoreIntervals)
  // 后端返回中文键名，用 i18n 映射翻译（仅对英文模式生效）
  const LABEL_MAP: Record<string, string> = {
    '极高(<60)': t('page.dashboard.riskLabel.extreme'),
    '高(60-80)': t('page.dashboard.riskLabel.high'),
    '中(80-100)': t('page.dashboard.riskLabel.mid'),
    '低(>=100)': t('page.dashboard.riskLabel.low'),
  }
  const scoreIntervalLabels = sortedScoreKeys.map((k) => LABEL_MAP[k] || k)

  return (
    <div className="h-full overflow-y-auto p-6 bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('page.dashboard.title')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('page.dashboard.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700
                     px-4 py-2 rounded-xl text-sm transition-all duration-200 shadow-sm hover:shadow-md"
        >
          🔄 {t('page.dashboard.refresh')}
        </button>
      </div>

      {/* 概览卡片 — 渐变色 + 阴影 + hover 效果 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          title={t('page.dashboard.stat.students')}
          value={s?.students ?? 0}
          color="blue"
          icon="👥"
        />
        <StatCard
          title={t('page.dashboard.stat.events')}
          value={s?.valid_events ?? 0}
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
          value={s?.total_delta?.toFixed(1) ?? '-'}
          color="purple"
          icon="📊"
        />
        <StatCard
          title={t('page.dashboard.stat.highRisk')}
          value={(scoreIntervals['极高(<60)'] ?? 0) + (scoreIntervals['高(60-80)'] ?? 0)}
          color="red"
          icon="⚠️"
        />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-2 gap-6 mb-6">
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
                data: scoreIntervalLabels,
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
          {summary?.risk_distribution ? (
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
                    data: Object.entries(summary.risk_distribution).map(([name, value]) => ({
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
      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* 原因码分布 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            {t('page.dashboard.chart.eventReason')}
          </h3>
          <div className="space-y-2">
            {stats?.reason_distribution?.slice(0, 8).map((item, idx) => (
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
                      width: `${Math.min(100, (item.count / (stats.reason_distribution[0]?.count ?? 1)) * 100)}%`,
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
            {ranking.slice(0, 10).map((r) => (
              <div
                key={r.entity_id}
                className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
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
                  <span className="text-gray-700 dark:text-gray-200 font-medium">{r.name}</span>
                </div>
                <span className="font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                  {r.score.toFixed(1)}
                </span>
              </div>
            ))}
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
          {summary ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-3 border border-green-200/50 dark:border-green-700/30">
                  <div className="text-gray-400 dark:text-gray-500">
                    {t('page.dashboard.summary.up')}
                  </div>
                  <div className="text-green-600 dark:text-green-400 font-bold text-lg">
                    {summary.events.bonus_count}
                  </div>
                  <div className="text-green-500/70 dark:text-green-400/70">
                    +{summary.events.bonus_total.toFixed(1)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 rounded-xl p-3 border border-red-200/50 dark:border-red-700/30">
                  <div className="text-gray-400 dark:text-gray-500">
                    {t('page.dashboard.summary.down')}
                  </div>
                  <div className="text-red-600 dark:text-red-400 font-bold text-lg">
                    {summary.events.deduct_count}
                  </div>
                  <div className="text-red-500/70 dark:text-red-400/70">
                    {summary.events.deduct_total.toFixed(1)}
                  </div>
                </div>
              </div>
              {summary.top_gainers.length > 0 && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    🏆 进步最快
                  </div>
                  {summary.top_gainers.slice(0, 3).map((g) => (
                    <div
                      key={g.name}
                      className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                    >
                      <span className="text-gray-600 dark:text-gray-300">{g.name}</span>
                      <span className="text-green-500 dark:text-green-400 font-mono font-medium">
                        +{g.delta.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {summary.top_losers.length > 0 && (
                <div>
                  <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    ⚠️ 退步最快
                  </div>
                  {summary.top_losers.slice(0, 3).map((l) => (
                    <div
                      key={l.name}
                      className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                    >
                      <span className="text-gray-600 dark:text-gray-300">{l.name}</span>
                      <span className="text-red-500 dark:text-red-400 font-mono font-medium">
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
      <div className="grid grid-cols-3 gap-6 mb-6">
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
