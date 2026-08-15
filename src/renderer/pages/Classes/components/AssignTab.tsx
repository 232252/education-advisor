// =============================================================
// 班级详情 — 调班 Tab：批量分入学生（含实时进度）
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

/** 调班 Tab：勾选未分班/其他班学生批量分入本班 */
export function AssignTab({
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
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-6 w-6" />}
        title={t('page.classes.profile.assign.empty')}
      />
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
            <div className="mt-3 mx-auto max-w-xs h-1.5 bg-gray-200 dark:bg-surface-elevated rounded-full overflow-hidden">
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
