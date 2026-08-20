// =============================================================
// 考试列表头部 — 标题 + 考试计数 + 创建/取消按钮
// =============================================================

import { Button } from '../../../../components/Button'
import { useT } from '../../../../i18n'

interface ExamListHeaderProps {
  examCount: number
  showCreateForm: boolean
  onToggleCreateForm: () => void
}

export function ExamListHeader({
  examCount,
  showCreateForm,
  onToggleCreateForm,
}: ExamListHeaderProps) {
  const { t } = useT()

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('page.academics.exams.listTitle', '考试列表')}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {t('page.academics.exams.total', '共')} {examCount}{' '}
          {t('page.academics.exams.examUnit', '场考试')}
        </p>
      </div>
      <Button onClick={onToggleCreateForm}>
        {showCreateForm
          ? t('common.cancel', '取消')
          : `+ ${t('page.academics.exams.createExam', '创建考试')}`}
      </Button>
    </div>
  )
}
