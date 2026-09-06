// =============================================================
// 单科成绩录入表 — 学生 × (成绩/班级排名) 行内输入 (科任老师模式)
// 卡头/输入格骨架见 ./table-parts
// =============================================================

import type { EAAStudent } from '@shared/types'
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

interface SingleSubjectRowProps {
  name: string
  score: string
  rank: string
  fullMark: number | undefined
  onUpdateScore: SingleSubjectTableProps['onUpdateScore']
}

/** 行级 memo:全部 props 为原始值 + 稳定回调,击键只重渲染被编辑的那一行 */
const SingleSubjectRow = memo(function SingleSubjectRow({
  name,
  score,
  rank,
  fullMark,
  onUpdateScore,
}: SingleSubjectRowProps) {
  return (
    <tr className={GRADE_ROW_CLASS}>
      <td className={GRADE_NAME_TD_CLASS}>{name}</td>
      <ScoreCell value={score} max={fullMark} onChange={(v) => onUpdateScore(name, 'score', v)} />
      <RankCell value={rank} onChange={(v) => onUpdateScore(name, 'rank', v)} />
    </tr>
  )
})

export function SingleSubjectTable({
  subjectName,
  fullMark,
  saving,
  onSave,
  students,
  singleScores,
  onUpdateScore,
}: SingleSubjectTableProps) {
  const { t } = useT()

  return (
    <GradeEntryTableShell
      title={`${t('page.academics.entry.singleSubjectTitle', '单科成绩录入')} — ${subjectName}`}
      saving={saving}
      onSave={onSave}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
            <th className="py-2 px-3 font-medium">{t('page.academics.common.student', '学生')}</th>
            <th className="py-2 px-3 font-medium text-center">
              {t('page.academics.common.score', '成绩')}
              <span className="text-[10px] text-gray-400 ml-1">/{fullMark}</span>
            </th>
            <th className="py-2 px-3 font-medium text-center">
              {t('print.studentReport.classRank', '班级排名')}
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const entry = singleScores[s.name]
            return (
              <SingleSubjectRow
                key={s.entity_id}
                name={s.name}
                score={entry?.score ?? ''}
                rank={entry?.rank ?? ''}
                fullMark={fullMark}
                onUpdateScore={onUpdateScore}
              />
            )
          })}
        </tbody>
      </table>
    </GradeEntryTableShell>
  )
}
