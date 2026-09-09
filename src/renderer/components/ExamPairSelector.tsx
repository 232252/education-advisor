// =============================================================
// ExamPairSelector — 考试 A/B 双选择器(Students/ExamCompareCard 与
// Academics/CompareSelectorBar 此前的同构 UI 收敛;className 全量
// 覆盖以保持两页的紧凑/标准两种视觉)
// =============================================================

import type { ExamDef } from '@shared/types'
import { useT } from '../i18n'
import { cn } from '../lib/ui-utils'

interface ExamPairSelectorProps {
  /** 按日期升序的考试列表 */
  sortedExams: ExamDef[]
  examAId: string
  examBId: string
  onExamAIdChange: (value: string) => void
  onExamBIdChange: (value: string) => void
  /** select 完整 className(默认 INPUT_BASE) */
  className?: string
}

export function ExamPairSelector({
  sortedExams,
  examAId,
  examBId,
  onExamAIdChange,
  onExamBIdChange,
  className,
}: ExamPairSelectorProps) {
  const { t } = useT()
  const options = sortedExams.map((e) => (
    <option key={e.id} value={e.id}>
      {e.name}（{e.date}）
    </option>
  ))
  return (
    <>
      <select
        value={examAId}
        onChange={(e) => onExamAIdChange(e.target.value)}
        className={cn(className)}
      >
        <option value="">{t('common.selectExamA', '选择考试 A')}</option>
        {options}
      </select>
      <span className="text-gray-400">→</span>
      <select
        value={examBId}
        onChange={(e) => onExamBIdChange(e.target.value)}
        className={cn(className)}
      >
        <option value="">{t('common.selectExamB', '选择考试 B')}</option>
        {options}
      </select>
    </>
  )
}
