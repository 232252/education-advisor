// =============================================================
// TaskCreateDialog — 新建批改任务(名称/学期/日期/班级/科目 + 量规)
// 创建即落草稿态;量规可留空后补(任务详情里继续编辑)。
// =============================================================

import { cleanPresetMarks } from '@shared/grading-helpers'
import type { GradingStrategy, GradingStrictness, RubricQuestion } from '@shared/types'
import { useState } from 'react'
import { useT } from '../../../i18n'
import { getCurrentSemester } from '../../../lib/academics'
import { btnStyle, CARD_BASE, INPUT_BASE } from '../../../lib/ui-utils'
import { RubricEditor } from './RubricEditor'

interface SubjectOption {
  id: string
  name: string
}

interface ClassOption {
  classId: string
  name: string
}

interface TaskCreateDialogProps {
  subjectOptions: SubjectOption[]
  classOptions: ClassOption[]
  saving: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    semester: string
    examDate?: string
    classId?: string
    className?: string
    subjectId?: string
    gradingMode?: GradingStrictness
    gradingStrategy?: GradingStrategy
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
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [gradingMode, setGradingMode] = useState<GradingStrictness>('normal')
  const [gradingStrategy, setGradingStrategy] = useState<GradingStrategy>('standard')
  const [rubric, setRubric] = useState<RubricQuestion[]>([])

  const canSave = name.trim().length > 0 && semester.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    const cls = classOptions.find((c) => c.classId === classId)
    const ok = await onCreate({
      name: name.trim(),
      semester: semester.trim(),
      examDate: examDate || undefined,
      classId: cls?.classId,
      className: cls?.name,
      subjectId: subjectId || undefined,
      gradingMode,
      gradingStrategy,
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
              <select
                id="grading-task-class"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                title={t('page.grading.task.classScopeTitle', '试卷归属与姓名识别默认只用该班级在读学生；不选则用全校名单')}
                className={`${INPUT_BASE} mt-1 w-full`}
              >
                <option value="">{t('page.grading.task.classAll', '不选（全校名单）')}</option>
                {classOptions.map((c) => (
                  <option key={c.classId} value={c.classId}>
                    {c.name}
                  </option>
                ))}
              </select>
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
            <div>
              <label className={labelCls} htmlFor="grading-task-mode">
                {t('page.grading.mode.label', '批改口径')}
              </label>
              <select
                id="grading-task-mode"
                value={gradingMode}
                onChange={(e) => setGradingMode(e.target.value as GradingStrictness)}
                title={t('page.grading.mode.title', '给分松紧口径，影响 AI 批改的扣分尺度')}
                className={`${INPUT_BASE} mt-1 w-full`}
              >
                <option value="normal">{t('page.grading.mode.normal', '正常')}</option>
                <option value="strict">{t('page.grading.mode.strict', '严格')}</option>
                <option value="lenient">{t('page.grading.mode.lenient', '宽松')}</option>
              </select>
              <p className="mt-1 text-[11px] leading-4 text-gray-400">
                {t(
                  'page.grading.mode.hint',
                  '严格=按步扣分不放过瑕疵；宽松=思路对小瑕疵少扣；随时可改，重改生效',
                )}
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="grading-task-strategy">
                {t('page.grading.strategy.label', '批改模式')}
              </label>
              <select
                id="grading-task-strategy"
                value={gradingStrategy}
                onChange={(e) => setGradingStrategy(e.target.value as GradingStrategy)}
                title={t(
                  'page.grading.strategy.title',
                  '批改流程档位：调用次数与准确率的权衡；改动后对之后的批改/重改生效',
                )}
                className={`${INPUT_BASE} mt-1 w-full`}
              >
                <option value="fast">{t('page.grading.strategy.fast', '快改 · 整卷一次')}</option>
                <option value="standard">
                  {t('page.grading.strategy.standard', '标准 · 分题细改+复验')}
                </option>
                <option value="dual">
                  {t('page.grading.strategy.dual', '双评 · 双AI独立批改')}
                </option>
              </select>
              <p className="mt-1 text-[11px] leading-4 text-gray-400">
                {t(
                  'page.grading.strategy.hint',
                  '快改=整卷一次调用最快最省；标准=逐题定位裁剪+条件复验，准确率优先；双评=两个视觉模型独立批改，阈值内取均值、分歧题交老师仲裁（需在设置→模型配置第二模型）',
                )}
              </p>
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
