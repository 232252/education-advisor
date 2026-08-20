// =============================================================
// ClassStep — 引导向导第 1 步: 创建班级
// 年级/班名/编号/班主任表单;编号默认由年级+班号自动生成,可手动覆盖。
// =============================================================

import { useT } from '../../../i18n'
import { cn, INPUT_BASE } from '../../../lib/ui-utils'
import { ComboBox } from '../../ComboBox'

/** 年级预设(初中 + 高中) */
const GRADE_PRESETS = ['七年级', '八年级', '九年级', '高一', '高二', '高三']
/** 班级名预设 */
const NAME_PRESETS = Array.from({ length: 20 }, (_, i) => `${i + 1}班`)

interface ClassStepProps {
  grade: string
  className: string
  classIdManual: string
  teacher: string
  creatingClass: boolean
  /** 根据年级+班名自动计算的编号 */
  autoClassId: string
  /** 实际生效编号(手动优先,否则自动) */
  effectiveClassId: string
  onGradeChange: (v: string) => void
  onClassNameChange: (v: string) => void
  onClassIdManualChange: (v: string) => void
  onTeacherChange: (v: string) => void
  /** 跳过引导(标记完成并关闭) */
  onSkip: () => void
  /** 创建班级并继续 */
  onCreate: () => void
}

export function ClassStep({
  grade,
  className,
  classIdManual,
  teacher,
  creatingClass,
  autoClassId,
  effectiveClassId,
  onGradeChange,
  onClassNameChange,
  onClassIdManualChange,
  onTeacherChange,
  onSkip,
  onCreate,
}: ClassStepProps) {
  const { t } = useT()
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
        {t('onboarding.class.title', '创建你的第一个班级')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('onboarding.class.desc', '学生必须归属于班级。选择年级与班号,编号将自动生成。')}
      </p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('onboarding.class.grade', '年级')} *
            </span>
            <ComboBox
              value={grade}
              onChange={onGradeChange}
              options={GRADE_PRESETS}
              placeholder={t('onboarding.class.grade.ph', '如: 七年级')}
              ariaLabel={t('onboarding.class.grade', '年级')}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('onboarding.class.name', '班级名称')} *
            </span>
            <ComboBox
              value={className}
              onChange={onClassNameChange}
              options={NAME_PRESETS}
              placeholder={t('onboarding.class.name.ph', '如: 3班')}
              ariaLabel={t('onboarding.class.name', '班级名称')}
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('onboarding.class.classId', '班级编号')}
          </span>
          <input
            type="text"
            value={classIdManual}
            onChange={(e) => onClassIdManualChange(e.target.value)}
            placeholder={autoClassId || 'G7-1'}
            className={cn('w-full font-mono', INPUT_BASE)}
          />
          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {effectiveClassId
              ? t('onboarding.class.classIdPreview', '将使用编号: {0}').replace(
                  '{0}',
                  effectiveClassId,
                )
              : t('onboarding.class.classIdHint', '根据年级与班号自动生成,可手动修改')}
          </span>
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('onboarding.class.teacher', '班主任姓名')}
          </span>
          <input
            type="text"
            value={teacher}
            onChange={(e) => onTeacherChange(e.target.value)}
            placeholder={t('onboarding.class.teacher.ph', '选填')}
            className={cn('w-full', INPUT_BASE)}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onSkip}
          className="px-3 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {t('onboarding.skip', '跳过引导')}
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={creatingClass || !effectiveClassId}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {creatingClass
            ? t('onboarding.creating', '创建中…')
            : t('onboarding.class.create', '创建班级并继续')}
        </button>
      </div>
    </div>
  )
}
