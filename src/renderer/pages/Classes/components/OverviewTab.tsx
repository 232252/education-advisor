// =============================================================
// Class profile — Overview tab: basic class fields
// =============================================================

import type { ClassEntity } from '@shared/types'
import { useMemo } from 'react'
import { useT } from '../../../i18n'

/** Overview tab: class_id / name / grade / teacher / count / created / note */
export function OverviewTab({
  classEntity,
  createdStr,
  studentCount,
  onViewGrades,
}: {
  classEntity: ClassEntity
  createdStr: string
  studentCount: number
  onViewGrades?: () => void
}) {
  const { t } = useT()
  const rows = useMemo<{ label: string; value: string }[]>(
    () => [
      { label: t('page.classes.profile.field.classId'), value: classEntity.class_id },
      { label: t('page.classes.col.name'), value: classEntity.name },
      { label: t('page.classes.profile.field.grade'), value: classEntity.grade || '-' },
      { label: t('page.classes.profile.field.teacher'), value: classEntity.teacher || '-' },
      { label: t('page.classes.profile.studentCount'), value: String(studentCount) },
      { label: t('page.classes.profile.field.createdAt'), value: createdStr },
    ],
    [t, classEntity, studentCount, createdStr],
  )
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="flex">
          <span className="w-24 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
            {r.label}
          </span>
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-200">{r.value}</span>
        </div>
      ))}
      {classEntity.note && (
        <div className="flex">
          <span className="w-24 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
            {t('page.classes.profile.field.note')}
          </span>
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
            {classEntity.note}
          </span>
        </div>
      )}
      {onViewGrades && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onViewGrades}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t('page.classes.grades.viewTab')}
          </button>
        </div>
      )}
    </div>
  )
}
