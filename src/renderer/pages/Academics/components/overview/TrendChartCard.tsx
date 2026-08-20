// =============================================================
// 成绩趋势线图卡 — X=考试名, Y=分数, 每个科目一条线
// M21: option 样板(轴/网格/图例/tooltip/折线 series)收敛到
// components/charts/option-builders,容器收敛到 ChartCard;
// 手写 isDark tooltip 三元色被 chartTheme 玻璃拟态统一替代。
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { ChartCard } from '../../../../components/charts/ChartCard'
import {
  axisTooltip,
  bottomLegend,
  categoryAxis,
  containGrid,
  lineSeries,
  valueAxis,
} from '../../../../components/charts/option-builders'
import { CHART_BRAND, useChartTheme } from '../../../../hooks/useChartTheme'
import { useT } from '../../../../i18n'
import { SUBJECT_COLORS } from '../../../../lib/academics'

interface TrendChartCardProps {
  /** 与成绩记录关联的有效考试 (按日期升序) */
  examsWithGrades: ExamDef[]
  subjects: SubjectDef[]
  grades: GradeRecord[]
}

export function TrendChartCard({ examsWithGrades, subjects, grades }: TrendChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()

  /** 趋势线图 option — X=考试名, Y=分数, 每个科目一条线 */
  const trendChartOption = useMemo(() => {
    const series = subjects
      .map((sub, idx) => {
        const data = examsWithGrades.map((exam) => {
          const g = grades.find((gr) => gr.examId === exam.id && gr.subjectId === sub.id)
          return g?.score ?? null
        })
        // 只显示有数据的科目
        if (!data.some((v) => v != null)) return null
        return lineSeries(sub.name, data, SUBJECT_COLORS[idx % SUBJECT_COLORS.length])
      })
      .filter(Boolean) as Array<Record<string, unknown>>

    return {
      animation: true,
      animationDuration: 800,
      tooltip: axisTooltip(chartTheme),
      legend: bottomLegend(chartTheme, {
        scroll: true,
        data: series.map((s) => s.name as string),
      }),
      grid: containGrid(40),
      xAxis: categoryAxis(
        examsWithGrades.map((e) => e.name),
        chartTheme,
      ),
      yAxis: valueAxis(chartTheme),
      series,
    }
  }, [examsWithGrades, grades, subjects, chartTheme])

  return (
    <ChartCard
      title={t('common.chart.trend')}
      dotColor={CHART_BRAND.blue}
      height={300}
      className="lg:col-span-2"
      option={examsWithGrades.length > 0 ? trendChartOption : null}
      emptyTitle={t('common.empty.noTrendData')}
      emptyIcon={<TrendingUp size={28} />}
      emptyClassName="h-[300px] py-0"
    />
  )
}
