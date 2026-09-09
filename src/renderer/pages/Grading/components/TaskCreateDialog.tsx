// =============================================================
// TaskCreateDialog — 新建批改任务(名称/学期/日期/班级/科目 + 量规)
// 创建即落草稿态;量规可留空后补(任务详情里继续编辑)。
// =============================================================

import { cleanPresetMarks } from '@shared/grading-helpers'
import type { RubricQuestion } from '@shared/types'
import { useState } from 'react'
import { useT } from '../../../i18n'
import { getCurrentSemester } from '../../../lib/academics'
import { btnStyle, CARD_BASE, INPUT_BASE } from '../../../lib/ui-utils'
import { RubricEditor } from './RubricEditor'

interface SubjectOption {
  id: string
  name: string
}

interface TaskCreateDialogProps {
  subjectOptions: SubjectOption[]
  classOptions: string[]
  saving: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    semester: string
    examDate?: string
    className?: string
    subjectId?: string
    rubric: RubricQuestion[]
  }) => Promise<boolean>
}

export function TaskCreateDialog({
  subjectOptions,
  classOptions,
  saving,
  onClose,
  onCreate,
}: TaskCreateDialogProps) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [semester, setSemester] = useState(getCurrentSemester())
  const [examDate, setExamDate] = useState('')
  const [className, setClassName] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [rubric, setRubric] = useState<RubricQuestion[]>([])

  const canSave = name.trim().length > 0 && semester.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    const ok = await onCreate({
      name: name.trim(),
      semester: semester.trim(),
      examDate: examDate || undefined,
      className: className.trim() || undefined,
      subjectId: subjectId || undefined,
      rubric: rubric
        .filter((q) => q.title.trim().length > 0 && q.fullMark > 0)
        .map((q, i) => ({ ...q, order: i + 1, presetMarks: cleanPresetMarks(q.presetMarks) })),
    })
    if (ok) onClose()
  }

  const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`${CARD_BASE} shadow-xl max-h-[85vh] w-[34rem] overflow-y-auto p-5`}>
        <h2 className="mb-4 text-sm font-semibold">{t('page.grading.create.title')}</h2>
        <div className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="grading-task-name">
              {t('page.grading.task.name')} *
            </label>
            <input
              id="grading-task-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('page.grading.create.namePlaceholder')}
              className={`${INPUT_BASE} mt-1 w-full`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="grading-task-semester">
                {t('page.grading.task.semester')} *
              </label>
              <input
                id="grading-task-semester"
                type="text"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className={`${INPUT_BASE} mt-1 w-full`}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="grading-task-date">
                {t('page.grading.task.date')}
              </label>
              <input
                id="grading-task-date"
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className={`${INPUT_BASE} mt-1 w-full`}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="grading-task-class">
                {t('page.grading.task.class')}
              </label>
              <input
                id="grading-task-class"
                type="text"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                list="grading-class-options"
                className={`${INPUT_BASE} mt-1 w-full`}
              />
              <datalist id="grading-class-options">
                {classOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls} htmlFor="grading-task-subject">
                {t('page.grading.task.subject')}
              </label>
              <select
                id="grading-task-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className={`${INPUT_BASE} mt-1 w-full`}
              >
                <option value="">{t('page.grading.task.noSubject')}</option>
                {subjectOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <span className={labelCls}>{t('page.grading.rubric.title')}</span>
            <div className="mt-1.5">
              <RubricEditor value={rubric} onChange={setRubric} />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnStyle('secondary')}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={btnStyle('primary')}
          >
            {t('page.grading.create.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
