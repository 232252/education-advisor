// =============================================================
// 全科成绩录入表 — 科目 × (成绩/班级排名) 行内输入 (班主任模式)
// =============================================================

import type { SubjectDef } from '@shared/types'
import { Save } from 'lucide-react'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'
import { useT } from '../../../../i18n'
import type { ScoreEntry } from '../../lib/grade-entry'

interface AllSubjectsTableProps {
  studentName: string
  subjects: SubjectDef[]
  allScores: Record<string, ScoreEntry>
  saving: boolean
  onSave: () => void
  onUpdateScore: (subjectId: string, field: 'score' | 'rank', value: string) => void
}

export function AllSubjectsTable({
  studentName,
  subjects,
  allScores,
  saving,
  onSave,
  onUpdateScore,
}: AllSubjectsTableProps) {
  const { t } = useT()

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {`${t('page.academics.entry.allSubjectsTitle', '全科成绩录入')} — ${studentName}`}
        </h4>
        <Button
          variant="success"
          size="sm"
          loading={saving}
          icon={!saving ? <Save className="h-3.5 w-3.5" /> : undefined}
          onClick={onSave}
        >
          {saving
            ? t('page.academics.entry.saving', '保存中...')
            : t('page.academics.entry.saveGrades', '保存成绩')}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
              <th className="py-2 px-3 font-medium">{t('print.parentReport.subject', '科目')}</th>
              <th className="py-2 px-3 font-medium text-center">
                {t('print.parentReport.fullScore', '满分')}
              </th>
              <th className="py-2 px-3 font-medium text-center">
                {t('page.academics.common.score', '成绩')}
              </th>
              <th className="py-2 px-3 font-medium text-center">
                {t('print.studentReport.classRank', '班级排名')}
              </th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((sub) => {
              const entry = allScores[sub.id]
              return (
                <tr
                  key={sub.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                >
                  <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">
                    {sub.name}
                    {sub.isCore && (
                      <span className="ml-1 text-[10px] text-blue-500">
                        {t('page.academics.common.coreSubject', '主科')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center text-gray-400 dark:text-gray-500 font-mono">
                    {sub.fullMark}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="number"
                      value={entry?.score ?? ''}
                      onChange={(e) => onUpdateScore(sub.id, 'score', e.target.value)}
                      placeholder="-"
                      min="0"
                      max={sub.fullMark}
                      step="0.5"
                      className="w-20 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="number"
                      value={entry?.rank ?? ''}
                      onChange={(e) => onUpdateScore(sub.id, 'rank', e.target.value)}
                      placeholder="-"
                      min="1"
                      className="w-16 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
