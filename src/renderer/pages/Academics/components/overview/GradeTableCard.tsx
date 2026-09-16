// =============================================================
// 成绩明细表卡 — 按考试日期降序展示各科分数与班级排名
// (行数据由 lib/academics-metrics.ts 的 buildGradeTableData 构造)
// 每行可删除该生该场考试的全部记录(清幽灵成绩,两段式确认)。
// =============================================================

import type { SubjectDef } from '@shared/types'
import { useState } from 'react'
import { Badge } from '../../../../components/Badge'
import { Card } from '../../../../components/Card'
import { useT } from '../../../../i18n'
import { EXAM_TYPE_BADGE, EXAM_TYPE_LABEL, type GradeTableRow } from '../../../../lib/academics'
import { cn } from '../../../../lib/ui-utils'

interface GradeTableCardProps {
  /** 表格行数据 (按考试日期降序) */
  tableData: GradeTableRow[]
  subjects: SubjectDef[]
  /** 删除该生某场考试的全部记录;组件内两段式确认后调用 */
  onRemoveExamGrades?: (examId: string) => Promise<boolean> | boolean
}

export function GradeTableCard({ tableData, subjects, onRemoveExamGrades }: GradeTableCardProps) {
  const { t } = useT()
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const handleRemove = async (examId: string) => {
    if (!onRemoveExamGrades) return
    setRemovingId(examId)
    try {
      await onRemoveExamGrades(examId)
    } finally {
      setRemovingId(null)
      setConfirmRemoveId(null)
    }
  }

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-orange-500" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          📋 {t('page.academics.overview.gradeDetails', '成绩明细')}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
              <th className="py-2 px-3 font-medium">{t('print.studentReport.exam', '考试')}</th>
              <th className="py-2 px-3 font-medium">{t('print.studentReport.type', '类型')}</th>
              <th className="py-2 px-3 font-medium">{t('print.studentReport.date', '日期')}</th>
              {subjects.map((sub) => (
                <th key={sub.id} className="py-2 px-3 font-medium text-center">
                  {sub.name}
                  <span className="text-[10px] text-gray-400 ml-0.5">/{sub.fullMark}</span>
                </th>
              ))}
              <th className="py-2 px-3 font-medium text-center">
                {t('print.studentReport.classRank', '班级排名')}
              </th>
              {onRemoveExamGrades && <th className="py-2 px-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {tableData.map(({ exam, scoresBySubject, classRank }) => (
              <tr
                key={exam.id}
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              >
                <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">
                  {exam.name}
                </td>
                <td className="py-2 px-3">
                  <Badge variant={EXAM_TYPE_BADGE[exam.type]}>{EXAM_TYPE_LABEL[exam.type]}</Badge>
                </td>
                <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs">{exam.date}</td>
                {subjects.map((sub) => {
                  const g = scoresBySubject[sub.id]
                  return (
                    <td
                      key={sub.id}
                      className="py-2 px-3 text-center font-mono text-gray-700 dark:text-gray-300"
                    >
                      {g?.score != null ? (
                        <span
                          className={cn(
                            g.score >= sub.fullMark * 0.85
                              ? 'text-green-600 dark:text-green-400 font-medium'
                              : g.score < sub.fullMark * 0.6
                                ? 'text-red-600 dark:text-red-400 font-medium'
                                : '',
                          )}
                        >
                          {g.score}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                  )
                })}
                <td className="py-2 px-3 text-center font-mono">
                  {classRank != null ? (
                    <span className="text-blue-600 dark:text-blue-400 font-medium">
                      {t('page.academics.common.rankPrefix', '第')} {classRank}
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">-</span>
                  )}
                </td>
                {onRemoveExamGrades && (
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {confirmRemoveId === exam.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          {t('page.academics.overview.removeExamConfirm')}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleRemove(exam.id)}
                          disabled={removingId === exam.id}
                          className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
                        >
                          {removingId === exam.id
                            ? t('page.academics.overview.removing')
                            : t('common.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="text-xs text-gray-400 hover:underline"
                        >
                          {t('common.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(exam.id)}
                        title={t('page.academics.overview.removeExamTitle')}
                        className="text-xs text-gray-400 hover:text-red-500 hover:underline"
                      >
                        {t('page.academics.overview.removeExam')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
