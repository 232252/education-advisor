// =============================================================
// 对比选择器栏 — 班级筛选 + 考试 A/B 选择 + 学生计数
// =============================================================

import type { ClassEntity, ExamDef } from '@shared/types'
import { Card } from '../../../../components/Card'
import { useT } from '../../../../i18n'
import { cn, INPUT_BASE } from '../../../../lib/ui-utils'

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
        <select
          value={classFilter}
          onChange={(e) => onClassFilterChange(e.target.value)}
          className={cn(INPUT_BASE)}
        >
          <option value="__ALL__">{t('page.academics.class.all', '全部班级')}</option>
          <option value="__NONE__">{t('page.classes.profile.unassigned', '未分班')}</option>
          {classList.map((c) => (
            <option key={c.class_id} value={c.class_id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-gray-400 text-sm">|</span>
        <select
          value={examAId}
          onChange={(e) => onExamAIdChange(e.target.value)}
          className={cn(INPUT_BASE)}
        >
          <option value="">{t('page.academics.compare.selectExamA', '选择考试 A')}</option>
          {sortedExams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}（{e.date}）
            </option>
          ))}
        </select>
        <span className="text-gray-400">→</span>
        <select
          value={examBId}
          onChange={(e) => onExamBIdChange(e.target.value)}
          className={cn(INPUT_BASE)}
        >
          <option value="">{t('page.academics.compare.selectExamB', '选择考试 B')}</option>
          {sortedExams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}（{e.date}）
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">
          {studentCount} {t('page.academics.compare.studentUnit', '名学生')}
        </span>
      </div>
    </Card>
  )
}
