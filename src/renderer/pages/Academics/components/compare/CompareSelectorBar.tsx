// =============================================================
// 对比选择器栏 — 班级筛选 + 考试 A/B 选择 + 学生计数
// =============================================================

import type { ClassEntity, ExamDef } from '@shared/types'
import { Card } from '../../../../components/Card'
import { ClassFilterSelect } from '../../../../components/ClassFilterSelect'
import { ExamPairSelector } from '../../../../components/ExamPairSelector'
import { useT } from '../../../../i18n'
import { INPUT_BASE } from '../../../../lib/ui-utils'

interface CompareSelectorBarProps {
  classFilter: string
  onClassFilterChange: (value: string) => void
  examAId: string
  onExamAIdChange: (value: string) => void
  examBId: string
  onExamBIdChange: (value: string) => void
  classList: ClassEntity[]
  /** 按日期升序的考试列表 */
  sortedExams: ExamDef[]
  /** 当前筛选下的学生数 */
  studentCount: number
}

export function CompareSelectorBar({
  classFilter,
  onClassFilterChange,
  examAId,
  onExamAIdChange,
  examBId,
  onExamBIdChange,
  classList,
  sortedExams,
  studentCount,
}: CompareSelectorBarProps) {
  const { t } = useT()

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-center gap-3">
        <ClassFilterSelect
          value={classFilter}
          onChange={onClassFilterChange}
          classes={classList}
          allLabel={t('page.academics.class.all', '全部班级')}
          noneLabel={t('page.classes.profile.unassigned', '未分班')}
        />
        <span className="text-gray-400 text-sm">|</span>
        <ExamPairSelector
          sortedExams={sortedExams}
          examAId={examAId}
          examBId={examBId}
          onExamAIdChange={onExamAIdChange}
          onExamBIdChange={onExamBIdChange}
          className={INPUT_BASE}
        />
        <span className="text-xs text-gray-400 ml-auto">
          {studentCount} {t('page.academics.compare.studentUnit', '名学生')}
        </span>
      </div>
    </Card>
  )
}
