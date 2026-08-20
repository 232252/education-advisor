// =============================================================
// RiskDistChartCard — 风险等级饼图卡片
// 职责：接收风险分布数据 + 主题，内部构造并 memo ECharts option。
// M21: tooltip/图例/容器样板收敛到 charts 共享层;
// 仅保留本图语义(风险等级色映射 + 环形饼)。
// =============================================================

import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import { ChartCard } from '../../../components/charts/ChartCard'
import { bottomLegend, itemTooltip } from '../../../components/charts/option-builders'
import { CHART_BRAND, type ChartTheme, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'

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
    tooltip: itemTooltip(chartTheme, { formatter: '{b}: {c} 人 ({d}%)' }),
    legend: bottomLegend(chartTheme),
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
    <ChartCard
      title={t('page.dashboard.chart.riskDist')}
      dotColor={CHART_BRAND.violet}
      height={260}
      option={riskDistribution ? option : null}
      emptyTitle={t('common.empty.noData')}
      emptyIcon={<BarChart3 size={28} />}
      emptyClassName="py-6"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    />
  )
}
