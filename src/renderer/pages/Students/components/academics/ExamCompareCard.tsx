// =============================================================
// 考试对比卡片 — 从 AcademicsTab 提取
// A/B 考试选择器 + 各科目对比表 + 总分行 + 汇总/操行分 + 并排柱状图
// =============================================================

import type { ExamDef } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { DeltaBadge } from '../../../../components/DeltaBadge'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { echarts } from '../../../../lib/echarts-setup'
import { CARD_BASE, cn } from '../../../../lib/ui-utils'
import type { StudentComparison } from '../../../Academics/exam-comparison'

interface ExamCompareCardProps {
  /** 可选考试列表（有成绩且按日期升序） */
  sortedExams: ExamDef[]
  compareExamAId: string
  compareExamBId: string
  onCompareExamAChange: (value: string) => void
  onCompareExamBChange: (value: string) => void
  /** 对比计算结果（null = 未选择两场不同考试） */
  comparison: StudentComparison | null
}

export function ExamCompareCard({
  sortedExams,
  compareExamAId,
  compareExamBId,
  onCompareExamAChange,
  onCompareExamBChange,
  comparison,
}: ExamCompareCardProps) {
  const chartTheme = useChartTheme()

  return (
    <div className={`${CARD_BASE} p-4 shadow-sm`}>
      <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📈 考试对比</h5>

      {/* 对比选择器 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={compareExamAId}
          onChange={(e) => onCompareExamAChange(e.target.value)}
          className={cn(
            'text-xs rounded-lg border border-gray-300 dark:border-white/[0.08]',
            'bg-white dark:bg-surface-primary text-gray-700 dark:text-gray-300 px-2 py-1',
          )}
        >
          <option value="">选择考试 A</option>
          {sortedExams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}（{e.date}）
            </option>
          ))}
        </select>
        <span className="text-gray-400">→</span>
        <select
          value={compareExamBId}
          onChange={(e) => onCompareExamBChange(e.target.value)}
          className={cn(
            'text-xs rounded-lg border border-gray-300 dark:border-white/[0.08]',
            'bg-white dark:bg-surface-primary text-gray-700 dark:text-gray-300 px-2 py-1',
          )}
        >
          <option value="">选择考试 B</option>
          {sortedExams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}（{e.date}）
            </option>
          ))}
        </select>
      </div>

      {comparison ? (
        <div className="space-y-3">
          {/* 各科目对比表 */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 gap-2 text-[11px] text-gray-400 dark:text-gray-500 px-1">
              <div className="col-span-3">科目</div>
              <div className="col-span-2 text-center">A 分</div>
              <div className="col-span-2 text-center">B 分</div>
              <div className="col-span-2 text-center">分差</div>
              <div className="col-span-3 text-center">班排变化</div>
            </div>
            {comparison.subjects.map((s) => (
              <div
                key={s.subjectId}
                className="grid grid-cols-12 gap-2 text-xs items-center px-1 py-1 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04]"
              >
                <div className="col-span-3 text-gray-700 dark:text-gray-300">{s.subjectName}</div>
                <div className="col-span-2 text-center font-mono text-gray-600 dark:text-gray-300">
                  {s.scoreA ?? '-'}
                </div>
                <div className="col-span-2 text-center font-mono text-gray-600 dark:text-gray-300">
                  {s.scoreB ?? '-'}
                </div>
                <div className="col-span-2 text-center">
                  <DeltaBadge delta={s.scoreDelta} />
                </div>
                <div className="col-span-3 text-center">
                  {s.classRankDelta !== null ? (
                    <span className="text-gray-500 dark:text-gray-400">
                      {s.classRankA ?? '-'} → {s.classRankB ?? '-'}{' '}
                      <DeltaBadge delta={s.classRankDelta} type="rank" suffix="名" />
                    </span>
                  ) : (
                    <span className="text-gray-400">未录入</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 总分行 */}
          {comparison.totalScoreDelta !== null && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-white/[0.06] text-sm">
              <span className="text-gray-600 dark:text-gray-300 font-medium">总分</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-gray-700 dark:text-gray-200">
                  {comparison.totalScoreA}
                </span>
                <span className="text-gray-400">→</span>
                <span className="font-mono text-gray-700 dark:text-gray-200">
                  {comparison.totalScoreB}
                </span>
                <DeltaBadge delta={comparison.totalScoreDelta} suffix="分" />
              </div>
            </div>
          )}

          {/* 汇总 + 操行分 */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100 dark:border-white/[0.06] text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              进步{' '}
              <span className="text-green-600 dark:text-green-400 font-bold">
                {comparison.improvedSubjects}
              </span>{' '}
              科
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              退步{' '}
              <span className="text-red-600 dark:text-red-400 font-bold">
                {comparison.declinedSubjects}
              </span>{' '}
              科
            </span>
            {comparison.unchangedSubjects > 0 && (
              <span className="text-gray-500 dark:text-gray-400">
                持平 {comparison.unchangedSubjects} 科
              </span>
            )}
            {comparison.conductDelta !== null && (
              <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                期间操行分
                <DeltaBadge delta={comparison.conductDelta} suffix="分" />
              </span>
            )}
          </div>

          {/* 并排柱状图 */}
          {comparison.subjects.filter((s) => s.scoreA !== null || s.scoreB !== null).length > 0 && (
            <div className="mt-2">
              <ReactEChartsCore
                echarts={echarts}
                style={{ height: 200 }}
                option={{
                  tooltip: { trigger: 'axis' },
                  legend: {
                    data: ['考试 A', '考试 B'],
                    textStyle: { color: chartTheme.legendColor },
                  },
                  grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                  xAxis: {
                    type: 'category',
                    data: comparison.subjects.map((s) => s.subjectName),
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
                      name: '考试 A',
                      type: 'bar',
                      data: comparison.subjects.map((s) => s.scoreA ?? '-'),
                      itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
                    },
                    {
                      name: '考试 B',
                      type: 'bar',
                      data: comparison.subjects.map((s) => s.scoreB ?? '-'),
                      itemStyle: { color: '#a855f7', borderRadius: [4, 4, 0, 0] },
                    },
                  ],
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
          {compareExamAId === compareExamBId && compareExamAId
            ? '请选择两场不同的考试'
            : '请选择两场考试进行对比'}
        </div>
      )}
    </div>
  )
}
