// =============================================================
// 班级详情面板 — 概览 / 学生名单 / 调班
// 学生数据来自父组件已加载的 listStudents（按 class_id 过滤），避免重复请求。
// 调班：批量分入（循环 EAA set-student-meta --class-id）、单个移出（--clear-class-id）。
// 编排层：持有 tab 状态，组合三个 Tab 组件。
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { btnStyle } from '../../lib/ui-utils'
import { AssignTab } from './components/AssignTab'
import { OverviewTab } from './components/OverviewTab'
import { StudentsTab } from './components/StudentsTab'
import { filterAssignableStudents, filterClassStudents, formatDate } from './lib/students'

interface ClassProfileProps {
  classEntity: ClassEntity
  /** 全量学生列表（由父组件传入，按 class_id 在本组件内过滤） */
  allStudents: EAAStudent[]
  /** 其他可用班级列表（非存档、非当前班），用于转班 */
  allClasses: ClassEntity[]
  onClose: () => void
  onRefresh: () => void
}

type TabId = 'overview' | 'students' | 'assign'

export function ClassProfile({
  classEntity,
  allStudents,
  allClasses,
  onClose,
  onRefresh,
}: ClassProfileProps) {
  const { t } = useT()
  const [tab, setTab] = useState<TabId>('overview')

  // 本班学生（按 class_id 过滤 + 按风险排序）
  const classStudents = useMemo(() => {
    return filterClassStudents(allStudents, classEntity.class_id)
  }, [allStudents, classEntity.class_id])

  // 可分入的学生：未分班 + 其他班（不含本班）
  const assignableStudents = useMemo(() => {
    return filterAssignableStudents(allStudents, classEntity.class_id)
  }, [allStudents, classEntity.class_id])

  // tabs memo 化（含动态计数，但只在 classStudents.length 变化时重建）
  const tabs = useMemo<{ id: TabId; label: string }[]>(
    () => [
      { id: 'overview', label: t('page.classes.profile.tabOverview') },
      {
        id: 'students',
        label: `${t('page.classes.profile.tabStudents')} (${classStudents.length})`,
      },
      { id: 'assign', label: t('page.classes.profile.tabAssign') },
    ],
    [t, classStudents.length],
  )

  const createdStr = formatDate(new Date(classEntity.created_at))

  return (
    <div className="h-full flex flex-col bg-white dark:bg-surface-primary">
      {/* 头部 */}
      <PageHeader
        title={classEntity.name}
        subtitle={`${classEntity.class_id} · ${t('page.classes.profile.studentCount').replace('{0}', String(classStudents.length))}`}
        size="sm"
        actions={
          <>
            {classEntity.archived && (
              <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-surface-elevated text-gray-500 dark:text-gray-400">
                {t('page.classes.status.archived')}
              </span>
            )}
            <button type="button" onClick={onClose} aria-label="关闭" className={btnStyle('ghost')}>
              ×
            </button>
          </>
        }
      />

      {/* Tab 导航 */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-white/[0.06] px-3 gap-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === tb.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <OverviewTab
            classEntity={classEntity}
            createdStr={createdStr}
            studentCount={classStudents.length}
          />
        )}
        {tab === 'students' && (
          <StudentsTab students={classStudents} otherClasses={allClasses} onRefresh={onRefresh} />
        )}
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
