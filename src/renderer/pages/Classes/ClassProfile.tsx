// =============================================================
// 班级详情面板 — 概览 / 学生名单 / 调班
// 学生数据来自父组件已加载的 listStudents（按 class_id 过滤），避免重复请求。
// 调班：批量分入（循环 EAA set-student-meta --class-id）、单个移出（--clear-class-id）。
// =============================================================

import type { ClassEntity, EAARiskLevel, EAAStudent } from '@shared/types'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

interface ClassProfileProps {
  classEntity: ClassEntity
  /** 全量学生列表（由父组件传入，按 class_id 在本组件内过滤） */
  allStudents: EAAStudent[]
  onClose: () => void
  onRefresh: () => void
}

type TabId = 'overview' | 'students' | 'assign'

/** 风险等级颜色（与 StudentsPage 保持一致） */
function riskColor(risk: EAARiskLevel): string {
  switch (risk) {
    case '低':
      return 'text-green-500 dark:text-green-400'
    case '中':
      return 'text-yellow-500 dark:text-yellow-400'
    case '高':
      return 'text-orange-500 dark:text-orange-400'
    case '极高':
      return 'text-red-500 dark:text-red-400 font-bold'
  }
}

const RISK_ORDER: Record<EAARiskLevel, number> = { 极高: 0, 高: 1, 中: 2, 低: 3 }

export function ClassProfile({ classEntity, allStudents, onClose, onRefresh }: ClassProfileProps) {
  const { t } = useT()
  const [tab, setTab] = useState<TabId>('overview')

  // 本班学生（按 class_id 过滤 + 按风险排序）
  const classStudents = useMemo(() => {
    return allStudents
      .filter((s) => s.class_id === classEntity.class_id)
      .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
  }, [allStudents, classEntity.class_id])

  // 可分入的学生：未分班 + 其他班（不含本班）
  const assignableStudents = useMemo(() => {
    return allStudents
      .filter((s) => s.class_id !== classEntity.class_id)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allStudents, classEntity.class_id])

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: t('page.classes.profile.tabOverview') },
    { id: 'students', label: `${t('page.classes.profile.tabStudents')} (${classStudents.length})` },
    { id: 'assign', label: t('page.classes.profile.tabAssign') },
  ]

  const created = new Date(classEntity.created_at)
  const createdStr = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* 头部 */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold truncate">{classEntity.name}</h2>
              {classEntity.archived && (
                <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  {t('page.classes.status.archived')}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
              <span className="font-mono">{classEntity.class_id}</span>
              <span>·</span>
              <span>
                {t('page.classes.profile.studentCount').replace(
                  '{0}',
                  String(classStudents.length),
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none px-1"
            aria-label="close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 px-3 gap-1">
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
          <StudentsTab classEntity={classEntity} students={classStudents} onRefresh={onRefresh} />
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

// -------------------- 概览 Tab --------------------
function OverviewTab({
  classEntity,
  createdStr,
  studentCount,
}: {
  classEntity: ClassEntity
  createdStr: string
  studentCount: number
}) {
  const { t } = useT()
  const rows: { label: string; value: string }[] = [
    { label: t('page.classes.profile.field.classId'), value: classEntity.class_id },
    { label: t('page.classes.col.name'), value: classEntity.name },
    { label: t('page.classes.profile.field.grade'), value: classEntity.grade || '-' },
    { label: t('page.classes.profile.field.teacher'), value: classEntity.teacher || '-' },
    { label: t('page.classes.profile.studentCount'), value: String(studentCount) },
    { label: t('page.classes.profile.field.createdAt'), value: createdStr },
  ]
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

// -------------------- 学生名单 Tab --------------------
function StudentsTab({
  classEntity,
  students,
  onRefresh,
}: {
  classEntity: ClassEntity
  students: EAAStudent[]
  onRefresh: () => void
}) {
  const { t } = useT()
  const [confirm, setConfirm] = useState<{ open: boolean; student?: EAAStudent }>({ open: false })

  const handleRemove = (student: EAAStudent) => {
    setConfirm({ open: true, student })
  }

  const doRemove = async () => {
    const student = confirm.student
    setConfirm({ open: false })
    if (!student) return
    try {
      const res = await getAPI().class.removeStudent({ student_name: student.name })
      if (!res.success) {
        toast.error(t('page.classes.profile.remove.failed').replace('{0}', res.error ?? ''))
        return
      }
      toast.success(t('page.classes.profile.remove.success').replace('{0}', student.name))
      onRefresh()
    } catch (err) {
      toast.error(
        t('page.classes.profile.remove.failed').replace(
          '{0}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    }
  }

  if (students.length === 0) {
    return (
      <div className="text-center text-sm text-gray-400 py-12">
        {t('page.classes.profile.noStudents')}
      </div>
    )
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white dark:bg-gray-900">
          <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
            <th className="py-2 px-2 font-medium">{t('page.classes.profile.col.name')}</th>
            <th className="py-2 px-2 font-medium">{t('page.classes.profile.col.risk')}</th>
            <th className="py-2 px-2 font-medium text-center">
              {t('page.classes.profile.col.score')}
            </th>
            <th className="py-2 px-2 font-medium text-center">
              {t('page.classes.profile.col.events')}
            </th>
            <th className="py-2 px-2 font-medium">{t('page.classes.profile.col.roles')}</th>
            <th className="py-2 px-2 font-medium text-center">
              {t('page.classes.profile.col.action')}
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.entity_id} className="border-b border-gray-100 dark:border-gray-800">
              <td className="py-2 px-2 font-medium">{s.name}</td>
              <td className={`py-2 px-2 ${riskColor(s.risk)}`}>{s.risk}</td>
              <td className="py-2 px-2 text-center text-gray-500 dark:text-gray-400">{s.score}</td>
              <td className="py-2 px-2 text-center text-gray-500 dark:text-gray-400">
                {s.events_count}
              </td>
              <td className="py-2 px-2 text-xs text-gray-400 dark:text-gray-500">
                {s.roles.length > 0 ? s.roles.join(', ') : '-'}
              </td>
              <td className="py-2 px-2 text-center">
                <button
                  type="button"
                  onClick={() => handleRemove(s)}
                  className="text-xs text-red-400/70 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  {t('page.classes.profile.remove')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={confirm.open}
        title={t('page.classes.profile.remove')}
        message={
          confirm.student
            ? t('page.classes.profile.remove.confirm')
                .replace('{0}', confirm.student.name)
                .replace('{1}', classEntity.name)
            : ''
        }
        variant="danger"
        onCancel={() => setConfirm({ open: false })}
        onConfirm={doRemove}
      />
    </div>
  )
}

// -------------------- 调班 Tab --------------------
function AssignTab({
  classEntity,
  assignable,
  onRefresh,
}: {
  classEntity: ClassEntity
  assignable: EAAStudent[]
  onRefresh: () => void
}) {
  const { t } = useT()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === assignable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(assignable.map((s) => s.name)))
    }
  }

  const handleAssign = async () => {
    const names = Array.from(selected)
    if (names.length === 0 || assigning) return
    setAssigning(true)
    try {
      const res = await getAPI().class.assign({
        class_id: classEntity.class_id,
        student_names: names,
      })
      if (!res.success) {
        toast.error(t('page.classes.profile.assign.failed').replace('{0}', res.error ?? ''))
        return
      }
      const assigned = res.assigned ?? 0
      const failed = res.failed ?? []
      if (failed.length === 0) {
        toast.success(t('page.classes.profile.assign.success').replace('{0}', String(assigned)))
      } else {
        toast.warning(
          t('page.classes.profile.assign.partial')
            .replace('{0}', String(assigned))
            .replace('{1}', String(failed.length))
            .replace('{2}', failed.slice(0, 3).join('; ')),
        )
      }
      setSelected(new Set())
      onRefresh()
    } catch (err) {
      toast.error(
        t('page.classes.profile.assign.failed').replace(
          '{0}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setAssigning(false)
    }
  }

  if (assignable.length === 0) {
    return (
      <div className="text-center text-sm text-gray-400 py-12">
        {t('page.classes.profile.assign.empty')}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {t('page.classes.profile.assign.hint').replace('{0}', classEntity.name)}
      </div>

      {assigning ? (
        <div className="py-8 text-center text-sm text-blue-600 dark:text-blue-400">
          {t('page.classes.profile.assign.processing')
            .replace('{0}', '0')
            .replace('{1}', String(selected.size))}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === assignable.length}
                onChange={toggleAll}
                className="accent-blue-500"
              />
              {t('page.classes.profile.assign.selected').replace('{0}', String(selected.size))}
            </label>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {assignable.map((s) => (
              <label
                key={s.entity_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.name)}
                  onChange={() => toggle(s.name)}
                  className="accent-blue-500"
                />
                <span className="text-sm">{s.name}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {s.class_id ? `← ${s.class_id}` : t('page.classes.profile.unassigned')}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={handleAssign}
              disabled={selected.size === 0}
              className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('page.classes.profile.assign.confirm')} ({selected.size})
            </button>
          </div>
        </>
      )}
    </div>
  )
}
