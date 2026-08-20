// =============================================================
// 概览选项卡 — 迷你趋势图 + 事件时间线
// 展示当前分数 / 分数变动 / 加扣分事件数 + 基本信息 + 最近事件
// =============================================================

import type { EAAHistoryData, EAAStudent, EAAStudentScore } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { ClipboardList } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { CHART_BRAND, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { echarts } from '../../../lib/echarts-setup'
import { CARD_BASE, riskColor } from '../../../lib/ui-utils'
import { EventMiniCard, InfoRow, MetricCard } from '../components'

export function OverviewTab({
  student,
  score,
  history,
}: {
  student: EAAStudent
  score: EAAStudentScore | null
  history: EAAHistoryData | null
  // isDark 保留为可选 prop 以维持调用方契约；主题色现由 useChartTheme 内部从 useTheme() 派生
  isDark?: boolean
}) {
  const { t } = useT()
  const recentEvents = history?.events?.slice(0, 5) ?? []
  const bonusCount = history?.events?.filter((e) => e.score_delta > 0).length ?? 0
  const deductCount = history?.events?.filter((e) => e.score_delta < 0).length ?? 0

  const scoreTimeline = useMemo(() => {
    if (!history?.events || history.events.length === 0)
      return { dates: [] as string[], scores: [] as number[] }
    let cumulative = 0
    const dates: string[] = []
    const scores: number[] = []
    const events = history.events.slice(-20)
    for (const evt of events) {
      cumulative += evt.score_delta
      dates.push(new Date(evt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }))
      scores.push(cumulative)
    }
    return { dates, scores }
  }, [history])

  // 接入 Phase 1 useChartTheme（替代手写 axisColor/gridColor）
  // 颜色映射与 Dashboard Task 10 一致：axisColor→legendColor，gridColor→gridColor
  const chartTheme = useChartTheme()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label={t('page.students.overview.currentScore', '当前分数')}
          value={student.score.toFixed(1)}
          color="blue"
        />
        <MetricCard
          label={t('page.students.overview.scoreChange', '分数变动')}
          value={(student.delta >= 0 ? '+' : '') + student.delta.toFixed(1)}
          color={student.delta >= 0 ? 'green' : 'red'}
        />
        <MetricCard
          label={t('page.students.overview.bonusEvents', '加分事件')}
          value={bonusCount}
          color="green"
        />
        <MetricCard
          label={t('page.students.overview.deductEvents', '扣分事件')}
          value={deductCount}
          color="red"
        />
      </div>

      {scoreTimeline.dates.length > 1 && (
        <div className={`${CARD_BASE} p-4 shadow-sm`}>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t('page.students.overview.scoreTrend', '📈 分数变化趋势')}
          </h4>
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 200 }}
            option={{
              animation: true,
              animationDuration: 800,
              grid: { left: 8, right: 16, top: 8, bottom: 0, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: {
                type: 'category',
                data: scoreTimeline.dates,
                axisLabel: { color: chartTheme.legendColor, fontSize: 10 },
                axisLine: { lineStyle: { color: chartTheme.gridColor } },
              },
              yAxis: {
                type: 'value',
                axisLabel: { color: chartTheme.legendColor },
                splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
              },
              series: [
                {
                  type: 'line',
                  data: scoreTimeline.scores,
                  smooth: true,
                  lineStyle: { color: CHART_BRAND.blue, width: 2 },
                  itemStyle: { color: CHART_BRAND.blue },
                  areaStyle: {
                    // 品牌蓝双向渐隐面积(单处使用,保留内联)
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: 'rgba(59,130,246,0.3)' },
                      { offset: 1, color: 'rgba(59,130,246,0.02)' },
                    ]),
                  },
                  symbol: 'circle',
                  symbolSize: 4,
                },
              ],
            }}
          />
        </div>
      )}

      <div className={`${CARD_BASE} p-4 shadow-sm`}>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('page.students.overview.basicInfo', '基本信息')}
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow
            label={t('page.students.profile.field.status', '状态')}
            value={score?.status ?? 'Active'}
          />
          <InfoRow
            label={t('page.students.overview.riskLevel', '风险等级')}
            value={student.risk}
            highlight={riskColor(student.risk)}
          />
          <InfoRow
            label={t('page.students.col.class', '班级')}
            value={score?.class_id ?? t('common.unset', '未设置')}
          />
          <InfoRow
            label={t('page.students.col.group', '分组')}
            value={student.groups.join(', ') || t('common.none', '无')}
          />
          <InfoRow
            label={t('page.students.col.role', '角色')}
            value={student.roles.join(', ') || t('common.none', '无')}
          />
          <InfoRow
            label={t('page.students.overview.eventCount', '事件总数')}
            value={student.events_count}
          />
          {score?.last_event_at && (
            <InfoRow
              label={t('page.students.overview.lastEvent', '最近事件')}
              value={new Date(score.last_event_at).toLocaleDateString()}
            />
          )}
        </div>
      </div>

      <div className={`${CARD_BASE} p-4 shadow-sm`}>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('page.students.overview.recentEvents', '📋 最近事件')}
        </h4>
        {recentEvents.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title={t('page.students.overview.noEvents', '暂无事件')}
            className="py-4"
          />
        ) : (
          <div className="space-y-0">
            {recentEvents.map((evt, idx) => (
              <div key={evt.event_id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      'w-2.5 h-2.5 rounded-full mt-1.5 ' +
                      (evt.score_delta > 0
                        ? 'bg-green-400'
                        : evt.score_delta < 0
                          ? 'bg-red-400'
                          : 'bg-gray-300')
                    }
                  />
                  {idx < recentEvents.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-200 dark:bg-surface-elevated my-0.5" />
                  )}
                </div>
                <div className="flex-1 pb-3">
                  <EventMiniCard event={evt} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
