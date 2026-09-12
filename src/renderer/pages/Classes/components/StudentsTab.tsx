// =============================================================
// 班级详情 — 学生名单 Tab：本班学生列表 + 单个转班
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../../../components/EmptyState'
import { tr, useT } from '../../../i18n'
import { errText, getAPI } from '../../../lib/ipc-client'
import { runIpcMutation } from '../../../lib/mutation'
import {
  cn,
  INPUT_BASE,
  riskColor,
  TABLE_ROW,
  TABLE_STICKY_HEAD,
  TABLE_TD,
  TABLE_TH,
} from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

/** 学生名单 Tab：含转出到其他班级 */
export function StudentsTab({
  students,
  otherClasses,
  onRefresh,
}: {
  students: EAAStudent[]
  otherClasses: ClassEntity[]
  onRefresh: () => void
}) {
  const { t } = useT()
  const navigate = useNavigate()
  // 转班状态: 正在转班的学生名 → 选中的目标 class_id
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({})
  const [transferring, setTransferring] = useState<string | null>(null)

  const handleTransfer = (studentName: string) => {
    const targetClassId = transferTarget[studentName]
    if (!targetClassId) {
      toast.warning(t('page.classes.transfer.noTarget'))
      return
    }
    return runIpcMutation(
      () =>
        getAPI().class.assign({
          class_id: targetClassId,
          student_names: [studentName],
        }),
      {
        onOk: () => {
          toast.success(tr('page.classes.transfer.done', { name: studentName }))
          setTransferTarget((prev) => {
            const next = { ...prev }
            delete next[studentName]
            return next
          })
          onRefresh()
        },
        failMsg: (r) =>
          tr('page.classes.transfer.failed', {
            detail: r.failed?.join(', ') || t('page.classes.transfer.unknownErr'),
          }),
        catchMsg: (err) => tr('page.classes.transfer.failed', { detail: errText(err) }),
        setBusy: (v) => setTransferring(v ? studentName : null),
      },
    )
  }

  if (students.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title={t('page.classes.profile.noStudents')}
      />
    )
  }

  return (
    <div>
      {otherClasses.length === 0 && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-xs">
          {t('page.classes.transfer.noOtherClass')}
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
              <td className={cn(TABLE_TD, 'font-medium')}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/academics?entity_id=${encodeURIComponent(s.entity_id)}`)
                  }
                  title={t('page.classes.grades.openAcademics')}
                  className="text-blue-600 dark:text-blue-400 hover:underline bg-transparent border-0 p-0 cursor-pointer font-medium"
                >
                  {s.name}
                </button>
              </td>
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
                    <option value="">{t('page.classes.transfer.target')}</option>
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
                    {transferring === s.name ? '...' : t('page.classes.transfer.action')}
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
