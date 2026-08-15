// =============================================================
// 班级详情 — 概览 Tab：基础信息字段列表
// =============================================================

import type { ClassEntity } from '@shared/types'
import { useMemo } from 'react'
import { useT } from '../../../i18n'

/** 概览 Tab：class_id/名称/年级/教师/学生数/创建日期/备注 */
export function OverviewTab({
  classEntity,
  createdStr,
  studentCount,
}: {
  classEntity: ClassEntity
  createdStr: string
  studentCount: number
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
    </div>
  )
}
