// =============================================================
// 添加学生表单 — 从 StudentsPage 提取（班级必填，含"请先创建班级"空态分支）
// =============================================================

import type { ClassEntity } from '@shared/types'
import { AlertTriangle } from 'lucide-react'
import { useT } from '../../../i18n'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface AddStudentFormProps {
  /** 活跃班级列表（为空时显示"请先创建班级"空态） */
  activeClassList: ClassEntity[]
  newStudentName: string
  onNewStudentNameChange: (value: string) => void
  newStudentClassId: string
  onNewStudentClassIdChange: (value: string) => void
  /** 确认添加 */
  onConfirm: () => void
  /** 取消（关闭表单并清空班级选择） */
  onCancel: () => void
}

export function AddStudentForm({
  activeClassList,
  newStudentName,
  onNewStudentNameChange,
  newStudentClassId,
  onNewStudentClassIdChange,
  onConfirm,
  onCancel,
}: AddStudentFormProps) {
  const { t } = useT()

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-surface-tertiary/50 flex gap-2 items-center animate-slide-up">
      {activeClassList.length === 0 ? (
        <div className="flex-1 text-sm text-amber-600 dark:text-amber-400 py-1 flex items-center gap-1.5">
          <AlertTriangle size={14} className="flex-shrink-0" />
          请先在「班级」页面创建班级，学生必须归属于某个班级
        </div>
      ) : (
        <>
          <input
            type="text"
            value={newStudentName}
            onChange={(e) => onNewStudentNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm()
            }}
            placeholder={`${t('page.students.col.name')}...`}
            className={cn('flex-1', INPUT_BASE)}
          />
          <select
            value={newStudentClassId}
            onChange={(e) => onNewStudentClassIdChange(e.target.value)}
            className={INPUT_BASE}
          >
            <option value="">选择班级 *</option>
            {activeClassList.map((c) => (
              <option key={c.class_id} value={c.class_id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!newStudentClassId || !newStudentName.trim()}
            className={btnStyle('primary')}
            aria-label={t('common.confirm')}
          >
            {t('common.confirm')}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onCancel}
        className={btnStyle('secondary')}
        aria-label={t('common.cancel')}
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}
