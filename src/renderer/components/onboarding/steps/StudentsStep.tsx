// =============================================================
// StudentsStep — 引导向导第 2 步: 添加学生名单
// 多行文本批量解析学生姓名;可跳过(稍后导入)或返回上一步。
// =============================================================

import { useT } from '../../../i18n'
import { cn, INPUT_BASE } from '../../../lib/ui-utils'

interface StudentsStepProps {
  studentsText: string
  addingStudents: boolean
  /** 已解析出的学生姓名列表 */
  parsedNames: string[]
  /** 已创建班级编号(用于文案展示) */
  createdClassId: string | null
  onStudentsTextChange: (v: string) => void
  /** 上一步 → 建班 */
  onBack: () => void
  /** 跳过,稍后导入 → 直接进入 Agent 步骤 */
  onSkipStep: () => void
  /** 添加学生并继续 */
  onAdd: () => void
}

export function StudentsStep({
  studentsText,
  addingStudents,
  parsedNames,
  createdClassId,
  onStudentsTextChange,
  onBack,
  onSkipStep,
  onAdd,
}: StudentsStepProps) {
  const { t } = useT()
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
        {t('onboarding.students.title', '添加学生名单')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {createdClassId
          ? t('onboarding.students.desc', '每行一名学生姓名,将加入班级 {0}。').replace(
              '{0}',
              createdClassId,
            )
          : t(
              'onboarding.students.descNoClass',
              '每行一名学生姓名。可稍后在「学生」页补充班级归属。',
            )}
      </p>
      <textarea
        value={studentsText}
        onChange={(e) => onStudentsTextChange(e.target.value)}
        rows={8}
        placeholder={t('onboarding.students.ph', '张三\n李四\n王五')}
        className={cn('w-full font-mono leading-relaxed resize-none', INPUT_BASE)}
        spellCheck={false}
      />
      {parsedNames.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {t('onboarding.students.count', '识别到 {0} 名学生').replace(
            '{0}',
            String(parsedNames.length),
          )}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          {t('onboarding.back', '上一步')}
        </button>
        <button
          type="button"
          onClick={onSkipStep}
          className="px-3 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {t('onboarding.students.skip', '跳过,稍后导入')}
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={addingStudents}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {addingStudents
            ? t('onboarding.students.adding', '添加中…')
            : parsedNames.length > 0
              ? t('onboarding.students.add', '添加 {0} 名学生并继续').replace(
                  '{0}',
                  String(parsedNames.length),
                )
              : t('common.next', '下一步')}
        </button>
      </div>
    </div>
  )
}
