// =============================================================
// RiskDistChartCard — 风险等级饼图卡片
// 职责：接收风险分布数据 + 主题，内部构造并 memo ECharts option。
// （option 构造函数不导出，避免 declaration emit 的 TS4058，
//   与代码库其他图表组件内联构造 option 的模式一致）
// =============================================================

import ReactEChartsCore from 'echarts-for-react/esm/core'
import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { type ChartTheme, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { echarts } from '../../../lib/echarts-setup'

interface RiskDistChartCardProps {
  /** 风险等级 → 人数（undefined 表示暂无数据） */
  riskDistribution: Record<string, number> | undefined
}

// 颜色辅助：按风险等级取色
const riskColorOf = (name: string) =>
  name === '极高' ? '#ef4444' : name === '高' ? '#f97316' : name === '中' ? '#eab308' : '#22c55e'

/** 构造风险等级环形饼图 option */
function buildRiskChartOption(
  riskDistribution: Record<string, number> | undefined,
  chartTheme: ChartTheme,
) {
  return {
    animation: true,
    animationDuration: 1000,
    animationEasing: 'elasticOut' as const,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 人 ({d}%)',
      ...chartTheme.tooltipOption,
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
        data: riskDistribution
          ? Object.entries(riskDistribution).map(([name, value]) => ({
              name,
              value,
              itemStyle: { color: riskColorOf(name) },
            }))
          : [],
      },
    ],
  }
}

export function RiskDistChartCard({ riskDistribution }: RiskDistChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()
  const option = useMemo(
    () => buildRiskChartOption(riskDistribution, chartTheme),
    [riskDistribution, chartTheme],
  )
  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
        {t('page.dashboard.chart.riskDist')}
      </h3>
      {riskDistribution ? (
        <ReactEChartsCore echarts={echarts} style={{ height: 260 }} option={option} />
      ) : (
        <EmptyState icon={<BarChart3 size={28} />} title="暂无数据" className="py-6" />
      )}
    </Card>
  )
}
