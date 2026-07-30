// =============================================================
// 班级详情面板 — 概览 / 学生名单 / 调班
// 学生数据来自父组件已加载的 listStudents（按 class_id 过滤），避免重复请求。
// 调班：批量分入（循环 EAA set-student-meta --class-id）、单个移出（--clear-class-id）。
// =============================================================

import type { ClassEntity, EAARiskLevel, EAAStudent } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import {
  btnStyle,
  cn,
  INPUT_BASE,
  riskColor,
  TABLE_ROW,
  TABLE_STICKY_HEAD,
  TABLE_TD,
  TABLE_TH,
} from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'

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

const RISK_ORDER: Record<EAARiskLevel, number> = { 极高: 0, 高: 1, 中: 2, 低: 3 }

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

  const created = new Date(classEntity.created_at)
  const createdStr = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`

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
              <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
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

// -------------------- 学生名单 Tab --------------------
function StudentsTab({
  students,
  otherClasses,
  onRefresh,
}: {
  students: EAAStudent[]
  otherClasses: ClassEntity[]
  onRefresh: () => void
}) {
  const { t } = useT()
  // 转班状态: 正在转班的学生名 → 选中的目标 class_id
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({})
  const [transferring, setTransferring] = useState<string | null>(null)

  const handleTransfer = async (studentName: string) => {
    const targetClassId = transferTarget[studentName]
    if (!targetClassId) {
      toast.warning('请先选择目标班级')
      return
    }
    setTransferring(studentName)
    try {
      const res = await getAPI().class.assign({
        class_id: targetClassId,
        student_names: [studentName],
      })
      if (res.success) {
        toast.success(`已将「${studentName}」转出`)
        setTransferTarget((prev) => {
          const next = { ...prev }
          delete next[studentName]
          return next
        })
        onRefresh()
      } else {
        toast.error(`转班失败: ${res.failed?.join(', ') || '未知错误'}`)
      }
    } catch (err) {
      toast.error(`转班失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setTransferring(null)
  }

  if (students.length === 0) {
    return <EmptyState icon="👥" title={t('page.classes.profile.noStudents')} />
  }

  return (
    <div>
      {otherClasses.length === 0 && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-xs">
          ⚠ 没有其他可用班级，如需转班请先创建新班级
        </div>
      )}
      <table className="w-full text-sm">
        <thead className={TABLE_STICKY_HEAD}>
          <tr>
            <th className={TABLE_TH}>{t('page.classes.profile.col.name')}</th>
            <th className={TABLE_TH}>{t('page.classes.profile.col.risk')}</th>
            <th className={cn(TABLE_TH, 'text-center')}>{t('page.classes.profile.col.score')}</th>
            <th className={cn(TABLE_TH, 'text-center')}>{t('page.classes.profile.col.events')}</th>
            <th className={TABLE_TH}>{t('page.classes.profile.col.roles')}</th>
            <th className={cn(TABLE_TH, 'text-center')}>{t('page.classes.profile.col.action')}</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.entity_id} className={TABLE_ROW}>
              <td className={cn(TABLE_TD, 'font-medium')}>{s.name}</td>
              <td className={cn(TABLE_TD, riskColor(s.risk))}>{s.risk}</td>
              <td className={cn(TABLE_TD, 'text-center text-gray-500 dark:text-gray-400')}>
                {s.score}
              </td>
              <td className={cn(TABLE_TD, 'text-center text-gray-500 dark:text-gray-400')}>
                {s.events_count}
              </td>
              <td className={cn(TABLE_TD, 'text-xs text-gray-400 dark:text-gray-500')}>
                {s.roles.length > 0 ? s.roles.join(', ') : '-'}
              </td>
              <td className={cn(TABLE_TD, 'text-center')}>
                <div className="flex items-center gap-1 justify-center">
                  <select
                    value={transferTarget[s.name] ?? ''}
                    onChange={(e) =>
                      setTransferTarget((prev) => ({ ...prev, [s.name]: e.target.value }))
                    }
                    disabled={otherClasses.length === 0}
                    className={cn('w-full', INPUT_BASE)}
                  >
                    <option value="">目标班</option>
                    {otherClasses.map((c) => (
                      <option key={c.class_id} value={c.class_id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleTransfer(s.name)}
                    disabled={!transferTarget[s.name] || transferring === s.name}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:text-gray-300 dark:disabled:text-gray-600 transition-colors"
                  >
                    {transferring === s.name ? '...' : '转班'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // 批量分入进度（主进程串行 spawn 逐个写入 EAA，较慢，需实时显示）
  const [progress, setProgress] = useState<{ current: number; total: number; lastName: string }>({
    current: 0,
    total: 0,
    lastName: '',
  })

  // 订阅主进程推送的分入进度事件；组件卸载时取消订阅
  useEffect(() => {
    const unsubscribe = getAPI().class.onAssignProgress((data) => {
      setProgress({ current: data.current, total: data.total, lastName: data.lastName })
    })
    return unsubscribe
  }, [])

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
    setProgress({ current: 0, total: names.length, lastName: '' })
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
    return <EmptyState icon="✅" title={t('page.classes.profile.assign.empty')} />
  }

  return (
    <div>
      <div className="mb-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {t('page.classes.profile.assign.hint').replace('{0}', classEntity.name)}
      </div>

      {assigning ? (
        <div className="py-8 text-center text-sm text-blue-600 dark:text-blue-400">
          {t('page.classes.profile.assign.processing')
            .replace('{0}', String(progress.current))
            .replace('{1}', String(progress.total || selected.size))}
          {progress.total > 0 && (
            <span className="ml-1">({Math.round((progress.current / progress.total) * 100)}%)</span>
          )}
          {progress.lastName && (
            <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 truncate">
              {progress.lastName}
            </div>
          )}
          {/* 进度条 */}
          {progress.total > 0 && (
            <div className="mt-3 mx-auto max-w-xs h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
          <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            {t('page.classes.profile.assign.slowHint', '正在逐个写入，请耐心等待…')}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200 dark:border-white/[0.06]">
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
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-white/[0.03] cursor-pointer"
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
              aria-label={t('page.classes.profile.assign.confirm')}
              className={btnStyle('primary')}
            >
              {t('page.classes.profile.assign.confirm')} ({selected.size})
            </button>
          </div>
        </>
      )}
    </div>
  )
}
