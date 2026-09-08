// =============================================================
// ScoreDistChartCard — 分数分布柱状图卡片
// 职责：接收分数区间数据 + 主题，内部构造并 memo ECharts option。
// M21: 轴/网格/tooltip 样板收敛到 components/charts/option-builders,
// 容器收敛到 ChartCard;仅保留本图语义(按分数区间分桶渐变着色)。
// =============================================================

import { useMemo } from 'react'
import { ChartCard } from '../../../components/charts/ChartCard'
import {
  axisTooltip,
  categoryAxis,
  containGrid,
  valueAxis,
  verticalGradient,
} from '../../../components/charts/option-builders'
import { CHART_BRAND, type ChartTheme, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { SCORE_INTERVAL_I18N } from '../dashboard-stats'

interface ScoreDistChartCardProps {
  /** 分数区间 → 人数 */
  scoreIntervals: Record<string, number>
  /** 排序后的区间键（x 轴顺序） */
  sortedScoreKeys: string[]
}

/** 构造分数分布柱状图 option（按分数区间分桶着色） */
/** 分数段 label(后端枚举) → 渐变两端色(极高红/低橙/中黄/其余绿) */
function scoreBandColors(label: string): [string, string] {
  if (label.includes('极高')) return ['#ef4444', '#dc2626']
  if (label.includes('低')) return ['#f97316', '#ea580c']
  if (label.includes('中')) return ['#eab308', '#ca8a04']
  return ['#22c55e', '#16a34a']
}

function buildScoreChartOption(
  scoreIntervals: Record<string, number>,
  sortedScoreKeys: string[],
  chartTheme: ChartTheme,
  /** 区间键翻译(数据层 key 是中文常量,轴标签按当前语言渲染) */
  translateKey: (key: string) => string,
) {
  return {
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut' as const,
    tooltip: axisTooltip(chartTheme),
    grid: containGrid(28),
    xAxis: categoryAxis(sortedScoreKeys.map(translateKey), chartTheme, { hideTick: true }),
    yAxis: valueAxis(chartTheme),
    series: [
      {
        type: 'bar',
        data: Object.entries(scoreIntervals).map(([label, count]) => ({
          value: count,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: verticalGradient(...scoreBandColors(label)),
          },
        })),
        barWidth: '50%',
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' },
        },
      },
    ],
  }
}

export function ScoreDistChartCard({ scoreIntervals, sortedScoreKeys }: ScoreDistChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()
  const option = useMemo(
    () =>
      buildScoreChartOption(
        scoreIntervals,
        sortedScoreKeys,
        chartTheme,
        (key) => t(SCORE_INTERVAL_I18N[key] ?? '', key),
      ),
    [scoreIntervals, sortedScoreKeys, chartTheme, t],
  )
  return (
    <ChartCard
      title={t('page.dashboard.chart.scoreDist')}
      dotColor={CHART_BRAND.blue}
      height={260}
      option={option}
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    />
  )
}
