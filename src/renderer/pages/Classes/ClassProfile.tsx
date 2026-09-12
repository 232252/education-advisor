// =============================================================
// Class profile panel — overview / roster / grades / assign
// Student data comes from the parent listStudents payload (filtered
// by class_id here) to avoid a second fetch.
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { Tabs } from '../../components/Tabs'
import { tr, useT } from '../../i18n'
import { btnStyle } from '../../lib/ui-utils'
import { AssignTab } from './components/AssignTab'
import { ClassGradesTab } from './components/ClassGradesTab'
import { OverviewTab } from './components/OverviewTab'
import { StudentsTab } from './components/StudentsTab'
import { filterAssignableStudents, filterClassStudents, formatDate } from './lib/students'

interface ClassProfileProps {
  classEntity: ClassEntity
  /** Full student list (filtered by class_id inside this component) */
  allStudents: EAAStudent[]
  /** Other usable classes (not archived, not current) for transfer */
  allClasses: ClassEntity[]
  onClose: () => void
  onRefresh: () => void
}

type TabId = 'overview' | 'students' | 'grades' | 'assign'

export function ClassProfile({
  classEntity,
  allStudents,
  allClasses,
  onClose,
  onRefresh,
}: ClassProfileProps) {
  const { t } = useT()
  const [tab, setTab] = useState<TabId>('overview')

  const classStudents = useMemo(() => {
    return filterClassStudents(allStudents, classEntity.class_id)
  }, [allStudents, classEntity.class_id])

  const assignableStudents = useMemo(() => {
    return filterAssignableStudents(allStudents, classEntity.class_id)
  }, [allStudents, classEntity.class_id])

  const tabs = useMemo<{ key: TabId; label: string }[]>(
    () => [
      { key: 'overview', label: t('page.classes.profile.tabOverview') },
      {
        key: 'students',
        label: `${t('page.classes.profile.tabStudents')} (${classStudents.length})`,
      },
      { key: 'grades', label: t('page.classes.profile.tabGrades') },
      { key: 'assign', label: t('page.classes.profile.tabAssign') },
    ],
    [t, classStudents.length],
  )

  const createdStr = formatDate(new Date(classEntity.created_at))

  return (
    <div className="h-full flex flex-col bg-white dark:bg-surface-primary">
      <PageHeader
        title={classEntity.name}
        subtitle={`${classEntity.class_id} · ${tr('page.classes.profile.studentCount', { 0: String(classStudents.length) })}`}
        size="sm"
        actions={
          <>
            {classEntity.archived && (
              <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-surface-elevated text-gray-500 dark:text-gray-400">
                {t('page.classes.status.archived')}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className={btnStyle('ghost')}
            >
              ×
            </button>
          </>
        }
      />

      <Tabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        label={classEntity.name}
        idPrefix="class-profile"
        size="sm"
        className="px-3 gap-1"
      />

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <OverviewTab
            classEntity={classEntity}
            createdStr={createdStr}
            studentCount={classStudents.length}
            onViewGrades={() => setTab('grades')}
          />
        )}
        {tab === 'students' && (
          <StudentsTab students={classStudents} otherClasses={allClasses} onRefresh={onRefresh} />
        )}
        {tab === 'grades' && <ClassGradesTab students={classStudents} />}
        {tab === 'assign' && (
          <AssignTab
            classEntity={classEntity}
            assignable={assignableStudents}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  )
}
