// =============================================================
// GradingMarksDocument — 批阅痕迹打印版式
// 每份试卷: 页眉(学生/总分) → 逐题得分表 → 总评 → 扫描件叠红框。
// 打印对话框选「另存为 PDF」或送到打印机;多份试卷自动分页。
// =============================================================

import {
  effectiveTotalScore,
  paperMarkOverlays,
  paperMarkScoreRows,
  rubricFullMark,
} from '@shared/grading-helpers'
import type { GradingPaper, GradingTask } from '@shared/types'
import { tr, useT } from '../../i18n'
import { PaperScanPages } from './PaperScanPages'
import { printStamp } from './primitives'

export interface GradingMarksPaperView {
  paper: GradingPaper
  imageUrls: string[]
}

interface GradingMarksDocumentProps {
  task: Pick<GradingTask, 'name' | 'semester' | 'className' | 'examDate' | 'rubric'>
  papers: GradingMarksPaperView[]
  generatedAt?: Date
}

export function GradingMarksDocument({
  task,
  papers,
  generatedAt = new Date(),
}: GradingMarksDocumentProps) {
  const { t } = useT()
  const stamp = printStamp(generatedAt)
  const fullMark = rubricFullMark(task.rubric)

  return (
    <div className="text-gray-900">
      {papers.map((item, idx) => {
        const { paper } = item
        const total = effectiveTotalScore(paper)
        const rows = paperMarkScoreRows(paper, task.rubric)
        const overlays = paperMarkOverlays(paper, task.rubric)
        const student = paper.studentName ?? t('print.gradingMarks.unassigned', '未归组')
        return (
          <section
            key={paper.id}
            className={idx > 0 ? 'grading-marks-paper mt-10' : 'grading-marks-paper'}
          >
            <div className="flex items-end justify-between border-b-2 border-gray-900 pb-3">
              <div>
                <h1 className="text-xl font-bold tracking-wide">
                  {t('print.gradingMarks.title', '批阅痕迹')} — {task.name}
                </h1>
                <p className="mt-1 text-xs text-gray-500">
                  {t('print.gradingMarks.student', '学生')}: {student}
                  {task.className ? ` · ${task.className}` : ''}
                  {task.examDate ? ` · ${task.examDate}` : ''}
                  {task.semester ? ` · ${task.semester}` : ''}
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-bold">
                  {total ?? '—'}/{fullMark}
                </div>
                <div className="text-[10px] leading-4 text-gray-500">
                  {t('print.gradingMarks.total', '总分')}
                  <br />
                  {t('print.generatedAt', '生成日期')}: {stamp}
                </div>
              </div>
            </div>

            <p className="mt-2 text-[10px] text-red-700">
              {t('print.gradingMarks.legend', '红框为批阅痕迹（扣分或评语位置）')}
            </p>

            <table className="mt-3 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="py-1 pr-2 font-semibold">
                    {t('print.gradingMarks.question', '题号')}
                  </th>
                  <th className="py-1 pr-2 font-semibold">
                    {t('print.gradingMarks.fullMark', '满分')}
                  </th>
                  <th className="py-1 pr-2 font-semibold">
                    {t('print.gradingMarks.score', '得分')}
                  </th>
                  <th className="py-1 font-semibold">{t('print.gradingMarks.comment', '评语')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.questionId} className="border-b border-gray-200 align-top">
                    <td className="py-1.5 pr-2">
                      {i + 1}. {row.title}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{row.fullMark}</td>
                    <td className="py-1.5 pr-2 font-mono">{row.score ?? '—'}</td>
                    <td className="py-1.5">
                      {row.comment || row.evidence || '—'}
                      {row.markNotes.length > 0 && (
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          {row.markNotes.join(' · ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {paper.review?.overallComment && (
              <p className="mt-3 whitespace-pre-wrap text-xs">
                <span className="font-semibold">{t('print.gradingMarks.overall', '总评')}：</span>
                {paper.review.overallComment}
              </p>
            )}

            <h2 className="mt-4 mb-1 text-[13px] font-bold">
              {t('print.gradingMarks.scans', '卷面批注')}
            </h2>
            <PaperScanPages
              imageUrls={item.imageUrls}
              overlays={overlays}
              variant="print"
              emptyLabel={t('print.gradingMarks.noScans', '本份试卷没有扫描件')}
              pageCaption={(pageIdx) =>
                tr('print.gradingMarks.page', { n: pageIdx + 1 }, '第 {n} 页')
              }
            />
          </section>
        )
      })}

      <p className="mt-8 text-[10px] text-gray-400">
        {t(
          'print.gradingMarks.footer',
          '本批阅痕迹由 Education Advisor 在本地生成，可直接打印或另存为 PDF',
        )}
      </p>
    </div>
  )
}
