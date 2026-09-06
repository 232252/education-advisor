// =============================================================
// 全科成绩录入表 — 科目 × (成绩/班级排名) 行内输入 (班主任模式)
// 卡头/输入格骨架见 ./table-parts
// =============================================================

import type { SubjectDef } from '@shared/types'
import { memo } from 'react'
import { useT } from '../../../../i18n'
import type { ScoreEntry } from '../../lib/grade-entry'
import {
  GRADE_NAME_TD_CLASS,
  GRADE_ROW_CLASS,
  GradeEntryTableShell,
  RankCell,
  ScoreCell,
} from './table-parts'

interface AllSubjectsTableProps {
  studentName: string
  subjects: SubjectDef[]
  allScores: Record<string, ScoreEntry>
  saving: boolean
  onSave: () => void
  onUpdateScore: (subjectId: string, field: 'score' | 'rank', value: string) => void
}

interface AllSubjectsRowProps {
  /** 展示名 */
  name: string
  /** 更新键(= 科目 id) */
  id: string
  isCore: boolean
  coreLabel: string
  fullMark: number
  score: string
  rank: string
  onUpdateScore: AllSubjectsTableProps['onUpdateScore']
}

/** 行级 memo:全部 props 为原始值 + 稳定回调,击键只重渲染被编辑的那一行 */
const AllSubjectsRow = memo(function AllSubjectsRow({
  name,
  id,
  isCore,
  coreLabel,
  fullMark,
  score,
  rank,
  onUpdateScore,
}: AllSubjectsRowProps) {
  return (
    <tr className={GRADE_ROW_CLASS}>
      <td className={GRADE_NAME_TD_CLASS}>
        {name}
        {isCore && <span className="ml-1 text-[10px] text-blue-500">{coreLabel}</span>}
      </td>
      <td className="py-2 px-3 text-center text-gray-400 dark:text-gray-500 font-mono">
        {fullMark}
      </td>
      <ScoreCell value={score} max={fullMark} onChange={(v) => onUpdateScore(id, 'score', v)} />
      <RankCell value={rank} onChange={(v) => onUpdateScore(id, 'rank', v)} />
    </tr>
  )
})

export function AllSubjectsTable({
  studentName,
  subjects,
  allScores,
  saving,
  onSave,
  onUpdateScore,
}: AllSubjectsTableProps) {
  const { t } = useT()
  const coreLabel = t('page.academics.common.coreSubject', '主科')

  return (
    <GradeEntryTableShell
      title={`${t('page.academics.entry.allSubjectsTitle', '全科成绩录入')} — ${studentName}`}
      saving={saving}
      onSave={onSave}
    >
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
              <AllSubjectsRow
                key={sub.id}
                name={sub.name}
                id={sub.id}
                isCore={sub.isCore === true}
                coreLabel={coreLabel}
                fullMark={sub.fullMark}
                score={entry?.score ?? ''}
                rank={entry?.rank ?? ''}
                onUpdateScore={onUpdateScore}
              />
            )
          })}
        </tbody>
      </table>
    </GradeEntryTableShell>
  )
}
