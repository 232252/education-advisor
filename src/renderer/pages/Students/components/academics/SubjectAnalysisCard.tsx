// =============================================================
// 偏科分析卡片 — 从 AcademicsTab 提取
// 最强/最弱科目高亮 + 各科平均分柱状图
// =============================================================

import { EChart } from '../../../../components/charts/EChart'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { useT } from '../../../../i18n'
import { SUBJECT_COLORS, type SubjectAnalysis } from '../../../../lib/academics'
import { CARD_BASE } from '../../../../lib/ui-utils'

interface SubjectAnalysisCardProps {
  subjectAnalysis: SubjectAnalysis
}

export function SubjectAnalysisCard({ subjectAnalysis }: SubjectAnalysisCardProps) {
  const chartTheme = useChartTheme()
  const { t } = useT()
  const colors = SUBJECT_COLORS

  return (
    <div className={`${CARD_BASE} p-4 shadow-sm`}>
      <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
        {t('page.students.subjectAnalysis.title', '📊 偏科分析')}
      </h5>
      <div className="grid grid-cols-2 gap-4 mb-3">
        {subjectAnalysis.strongest && (
          <ExtremeSubjectBox
            tone="green"
            label={t('page.students.subjectAnalysis.strongest', '🏆 最强科目')}
            subject={subjectAnalysis.strongest.subject}
            avg={subjectAnalysis.strongest.avg}
            scoreUnit={t('page.students.academics.scoreUnit', '分')}
          />
        )}
        {subjectAnalysis.weakest && subjectAnalysis.all.length > 1 && (
          <ExtremeSubjectBox
            tone="red"
            label={t('page.students.subjectAnalysis.weakest', '⚠️ 最弱科目')}
            subject={subjectAnalysis.weakest.subject}
            avg={subjectAnalysis.weakest.avg}
            scoreUnit={t('page.students.academics.scoreUnit', '分')}
          />
        )}
      </div>
      <EChart
        height={180}
        option={{
          animation: true,
          animationDuration: 800,
          grid: { left: 38, right: 8, top: 8, bottom: 0, containLabel: true },
          tooltip: { trigger: 'axis' },
          xAxis: {
            type: 'category',
            data: subjectAnalysis.all.map((a) => a.subject),
            axisLabel: { color: chartTheme.legendColor, fontSize: 11 },
            axisLine: { lineStyle: { color: chartTheme.gridColor } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: chartTheme.legendColor },
            splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
          },
          series: [
            {
              type: 'bar',
              data: subjectAnalysis.all.map((a, i) => ({
                value: a.avg.toFixed(1),
                itemStyle: {
                  borderRadius: [4, 4, 0, 0],
                  color: colors[i % colors.length],
                },
              })),
              barWidth: '40%',
            },
          ],
        }}
      />
    </div>
  )
}

/** 最强/最弱科目格 — 双胞胎布局仅色调与文案不同 */
function ExtremeSubjectBox({
  tone,
  label,
  subject,
  avg,
  scoreUnit,
}: {
  tone: 'green' | 'red'
  label: string
  subject: string
  avg: number
  scoreUnit: string
}) {
  const boxClass =
    tone === 'green'
      ? 'from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 border-green-200/50 dark:border-green-700/30'
      : 'from-red-50 to-red-50 dark:from-red-900/10 dark:to-red-900/10 border-red-200/50 dark:border-red-700/30'
  const labelClass =
    tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  const subjectClass =
    tone === 'green' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
  const avgClass = tone === 'green' ? 'text-green-500' : 'text-red-500'
  return (
    <div className={`bg-gradient-to-br ${boxClass} rounded-lg p-3 border`}>
      <div className={`text-xs font-medium ${labelClass}`}>{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-lg font-bold ${subjectClass}`}>{subject}</span>
        <span className={`text-sm ${avgClass}`}>
          {avg.toFixed(1)}
          {scoreUnit}
        </span>
      </div>
    </div>
  )
}
