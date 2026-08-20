// =============================================================
// 科目平均分柱状图卡 — X=科目, Y=平均分
// M21: 轴/网格/tooltip 样板收敛到 charts 共享层,手写 isDark
// tooltip 三元色被 chartTheme 玻璃拟态统一替代;
// 仅保留本图语义(科目色渐变柱 + hasData tooltip formatter + 超 6 科目旋转标签)。
// =============================================================

import type { GradeRecord, SubjectDef } from '@shared/types'
import { useMemo } from 'react'
import { ChartCard } from '../../../../components/charts/ChartCard'
import {
  axisTooltip,
  categoryAxis,
  containGrid,
  valueAxis,
} from '../../../../components/charts/option-builders'
import { CHART_BRAND, useChartTheme } from '../../../../hooks/useChartTheme'
import { useT } from '../../../../i18n'
import { calcSubjectAvg, SUBJECT_COLORS } from '../../../../lib/academics'
import { echarts } from '../../../../lib/echarts-setup'

interface SubjectAvgChartCardProps {
  subjects: SubjectDef[]
  grades: GradeRecord[]
}

export function SubjectAvgChartCard({ subjects, grades }: SubjectAvgChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()

  /** 科目柱状图 option — X=科目, Y=平均分 */
  const subjectBarOption = useMemo(() => {
    const subjectAvgs = subjects.map((sub, idx) => {
      const avg = calcSubjectAvg(grades, sub.id)
      return {
        name: sub.name,
        value: avg != null ? Number(avg.toFixed(1)) : 0,
        hasData: avg != null,
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: SUBJECT_COLORS[idx % SUBJECT_COLORS.length] },
            { offset: 1, color: `${SUBJECT_COLORS[idx % SUBJECT_COLORS.length]}80` },
          ]),
        },
      }
    })

    return {
      animation: true,
      animationDuration: 800,
      tooltip: axisTooltip(chartTheme, {
        formatter: (params: Array<{ name: string; value: number; data: { hasData: boolean } }>) => {
          const p = params[0]
          return p.data.hasData
            ? `${p.name}: ${p.value} ${t('page.academics.common.scoreUnit', '分')}`
            : `${p.name}: ${t('common.empty.noData')}`
        },
      }),
      grid: containGrid(8),
      xAxis: categoryAxis(
        subjectAvgs.map((s) => s.name),
        chartTheme,
        { rotate: subjects.length > 6 ? 30 : 0, hideTick: true },
      ),
      yAxis: valueAxis(chartTheme),
      series: [
        {
          type: 'bar' as const,
          data: subjectAvgs,
          barWidth: '50%',
        },
      ],
    }
  }, [grades, subjects, chartTheme, t])

  return (
    <ChartCard
      title={t('page.academics.chart.subjectAvg')}
      dotColor={CHART_BRAND.green}
      height={260}
      option={subjectBarOption}
    />
  )
}
