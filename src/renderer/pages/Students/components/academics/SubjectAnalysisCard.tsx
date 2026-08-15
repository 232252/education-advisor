// =============================================================
// 偏科分析卡片 — 从 AcademicsTab 提取
// 最强/最弱科目高亮 + 各科平均分柱状图
// =============================================================

import ReactEChartsCore from 'echarts-for-react/esm/core'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { echarts } from '../../../../lib/echarts-setup'
import { CARD_BASE } from '../../../../lib/ui-utils'
import { ACADEMIC_CHART_COLORS, type SubjectAnalysis } from '../../lib/academics-metrics'

interface SubjectAnalysisCardProps {
  subjectAnalysis: SubjectAnalysis
}

export function SubjectAnalysisCard({ subjectAnalysis }: SubjectAnalysisCardProps) {
  const chartTheme = useChartTheme()
  const colors = ACADEMIC_CHART_COLORS

  return (
    <div className={`${CARD_BASE} p-4 shadow-sm`}>
      <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📊 偏科分析</h5>
      <div className="grid grid-cols-2 gap-4 mb-3">
        {subjectAnalysis.strongest && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-lg p-3 border border-green-200/50 dark:border-green-700/30">
            <div className="text-xs text-green-600 dark:text-green-400 font-medium">
              🏆 最强科目
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-bold text-green-700 dark:text-green-300">
                {subjectAnalysis.strongest.subject}
              </span>
              <span className="text-sm text-green-500">
                {subjectAnalysis.strongest.avg.toFixed(1)}分
              </span>
            </div>
          </div>
        )}
        {subjectAnalysis.weakest && subjectAnalysis.all.length > 1 && (
          <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/10 dark:to-rose-900/10 rounded-lg p-3 border border-red-200/50 dark:border-red-700/30">
            <div className="text-xs text-red-600 dark:text-red-400 font-medium">⚠️ 最弱科目</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-bold text-red-700 dark:text-red-300">
                {subjectAnalysis.weakest.subject}
              </span>
              <span className="text-sm text-red-500">
                {subjectAnalysis.weakest.avg.toFixed(1)}分
              </span>
            </div>
          </div>
        )}
      </div>
      <ReactEChartsCore
        echarts={echarts}
        style={{ height: 180 }}
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
