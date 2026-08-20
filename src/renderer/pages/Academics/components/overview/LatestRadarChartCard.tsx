// =============================================================
// 最新考试雷达图卡 — 每个科目一个轴, 显示最新一次考试的成绩
// M21: tooltip 收敛到 chartTheme 玻璃拟态(替代手写 isDark 三元色),
// 容器收敛到 ChartCard;仅保留本图语义(雷达轴 + 最新考试单系列)。
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { Target } from 'lucide-react'
import { useMemo } from 'react'
import { ChartCard } from '../../../../components/charts/ChartCard'
import { itemTooltip } from '../../../../components/charts/option-builders'
import { CHART_BRAND, useChartTheme } from '../../../../hooks/useChartTheme'
import { useTheme } from '../../../../hooks/useTheme'
import { useT } from '../../../../i18n'

interface LatestRadarChartCardProps {
  /** 与成绩记录关联的有效考试 (按日期升序) */
  examsWithGrades: ExamDef[]
  subjects: SubjectDef[]
  grades: GradeRecord[]
}

export function LatestRadarChartCard({
  examsWithGrades,
  subjects,
  grades,
}: LatestRadarChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()
  // splitArea 交替底色需要 isDark(仅此处未收敛进 chartTheme,属雷达图特有配置)
  const isDark = useTheme() === 'dark'

  /** 雷达图 option — 每个科目一个轴, 显示最新一次考试的成绩 */
  const radarChartOption = useMemo(() => {
    if (examsWithGrades.length === 0) return null

    const latestExam = examsWithGrades[examsWithGrades.length - 1]
    const indicator = subjects.map((sub) => ({
      name: sub.name,
      max: sub.fullMark,
    }))
    const latestScores = subjects.map((sub) => {
      const g = grades.find((gr) => gr.examId === latestExam.id && gr.subjectId === sub.id)
      return g?.score ?? 0
    })

    return {
      animation: true,
      animationDuration: 1000,
      tooltip: itemTooltip(chartTheme),
      radar: {
        indicator,
        radius: '65%',
        center: ['50%', '50%'],
        axisName: { color: chartTheme.legendColor, fontSize: 11 },
        splitLine: { lineStyle: { color: chartTheme.gridColor } },
        splitArea: {
          areaStyle: {
            color: isDark
              ? ['transparent', 'rgba(255,255,255,0.02)']
              : ['transparent', 'rgba(0,0,0,0.02)'],
          },
        },
        axisLine: { lineStyle: { color: chartTheme.gridColor } },
      },
      series: [
        {
          type: 'radar' as const,
          data: [
            {
              value: latestScores,
              name: latestExam.name,
              // 面积填充为品牌蓝低透明变体(单处使用,保留内联)
              areaStyle: { color: 'rgba(59,130,246,0.2)' },
              lineStyle: { color: CHART_BRAND.blue, width: 2 },
              itemStyle: { color: CHART_BRAND.blue },
            },
          ],
        },
      ],
    }
  }, [examsWithGrades, grades, subjects, chartTheme, isDark])

  return (
    <ChartCard
      title={t('page.academics.chart.latestRadar')}
      dotColor={CHART_BRAND.violet}
      height={260}
      option={radarChartOption}
      emptyTitle={t('common.empty.noData')}
      emptyIcon={<Target size={28} />}
      emptyClassName="h-[260px] py-0"
    />
  )
}
