// =============================================================
// 单科成绩录入表 — 学生 × (成绩/班级排名) 行内输入 (科任老师模式)
// =============================================================

import type { EAAStudent } from '@shared/types'
import { Save } from 'lucide-react'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'
import type { ScoreEntry } from '../../lib/grade-entry'

interface SingleSubjectTableProps {
  /** 科目名称 (表头展示) */
  subjectName: string | undefined
  /** 科目满分 (输入 max 上限与表头展示) */
  fullMark: number | undefined
  saving: boolean
  onSave: () => void
  /** 已过滤(未删除)并按姓名排序的学生列表 */
  students: EAAStudent[]
  singleScores: Record<string, ScoreEntry>
  onUpdateScore: (name: string, field: 'score' | 'rank', value: string) => void
}

export function SingleSubjectTable({
  subjectName,
  fullMark,
  saving,
  onSave,
  students,
  singleScores,
  onUpdateScore,
}: SingleSubjectTableProps) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          单科成绩录入 — {subjectName}
        </h4>
        <Button
          variant="success"
          size="sm"
          loading={saving}
          icon={!saving ? <Save className="h-3.5 w-3.5" /> : undefined}
          onClick={onSave}
        >
          {saving ? '保存中...' : '保存成绩'}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
              <th className="py-2 px-3 font-medium">学生</th>
              <th className="py-2 px-3 font-medium text-center">
                成绩
                <span className="text-[10px] text-gray-400 ml-1">/{fullMark}</span>
              </th>
              <th className="py-2 px-3 font-medium text-center">班级排名</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const entry = singleScores[s.name]
              return (
                <tr
                  key={s.entity_id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                >
                  <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">
                    {s.name}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="number"
                      value={entry?.score ?? ''}
                      onChange={(e) => onUpdateScore(s.name, 'score', e.target.value)}
                      placeholder="-"
                      min="0"
                      max={fullMark}
                      step="0.5"
                      className="w-20 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="number"
                      value={entry?.rank ?? ''}
                      onChange={(e) => onUpdateScore(s.name, 'rank', e.target.value)}
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
