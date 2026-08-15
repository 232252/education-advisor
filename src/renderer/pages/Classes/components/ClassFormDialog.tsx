// =============================================================
// 班级新建/编辑弹层 — 模板复制 + 编号自动生成 + 名称/年级组合框
// =============================================================

import type { ClassEntity, ClassUpsertParams } from '@shared/types'
import { ComboBox } from '../../../components/ComboBox'
import { useT } from '../../../i18n'
import { CARD_BASE, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface ClassFormDialogProps {
  classes: ClassEntity[]
  editingId: string | null
  form: ClassUpsertParams & { note?: string }
  saving: boolean
  templateId: string
  autoClassId: boolean
  nameOptions: string[]
  gradeOptions: string[]
  onClose: () => void
  onApplyTemplate: (classId: string) => void
  onClassIdChange: (v: string) => void
  onNameChange: (v: string) => void
  onGradeChange: (v: string) => void
  onTeacherChange: (v: string) => void
  onNoteChange: (v: string) => void
  onSave: () => void
}

/** 新建/编辑班级弹层（点击遮罩空白处关闭） */
export function ClassFormDialog({
  classes,
  editingId,
  form,
  saving,
  templateId,
  autoClassId,
  nameOptions,
  gradeOptions,
  onClose,
  onApplyTemplate,
  onClassIdChange,
  onNameChange,
  onGradeChange,
  onTeacherChange,
  onNoteChange,
  onSave,
}: ClassFormDialogProps) {
  const { t } = useT()

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`${CARD_BASE} animate-scale-in shadow-xl w-96 p-5`}>
        <h2 className="text-sm font-semibold mb-4">
          {editingId ? t('page.classes.edit') : t('page.classes.add')}
        </h2>
        <div className="space-y-3">
          {/* 复制已有班级为模板（仅新建模式） */}
          {!editingId && classes.length > 0 && (
            <label className="block">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('page.classes.form.template')}
              </span>
              <select
                value={templateId}
                onChange={(e) => onApplyTemplate(e.target.value)}
                className={cn('w-full', INPUT_BASE)}
              >
                <option value="">{t('page.classes.form.template.none')}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.class_id}>
                    {c.class_id} · {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('page.classes.form.classId')}
            </span>
            <input
              type="text"
              value={form.class_id}
              onChange={(e) => onClassIdChange(e.target.value)}
              disabled={!!editingId}
              placeholder="G7-3"
              className={cn(
                'w-full',
                INPUT_BASE,
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            />
            <span className="block text-xs text-gray-400 mt-0.5">
              {autoClassId && !editingId
                ? t('page.classes.form.classId.auto', '根据年级与班号自动生成，可手动修改')
                : t('page.classes.form.classId.hint')}
            </span>
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('page.classes.form.name')} *
            </span>
            <ComboBox
              value={form.name ?? ''}
              onChange={onNameChange}
              options={nameOptions}
              placeholder={t('page.classes.form.name.ph')}
              ariaLabel={t('page.classes.form.name')}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('page.classes.form.grade')}
            </span>
            <ComboBox
              value={form.grade ?? ''}
              onChange={onGradeChange}
              options={gradeOptions}
              placeholder={t('page.classes.form.grade.ph')}
              ariaLabel={t('page.classes.form.grade')}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('page.classes.form.teacher')}
            </span>
            <input
              type="text"
              value={form.teacher ?? ''}
              onChange={(e) => onTeacherChange(e.target.value)}
              placeholder={t('page.classes.form.teacher.ph')}
              className={cn('w-full', INPUT_BASE)}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('page.classes.form.note')}
            </span>
            <input
              type="text"
              value={form.note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder={t('page.classes.form.note.ph')}
              className={cn('w-full', INPUT_BASE)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
