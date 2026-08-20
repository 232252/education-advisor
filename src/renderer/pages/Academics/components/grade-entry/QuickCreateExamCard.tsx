// =============================================================
// 快速创建考试卡片 — 名称/类型/日期表单 + 创建/取消
// (GradeEntryTab 顶部"+"入口展开的独立视图)
// =============================================================

import type { ExamType } from '@shared/types'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'
import { useT } from '../../../../i18n'
import { cn, INPUT_BASE } from '../../../../lib/ui-utils'

interface QuickCreateExamCardProps {
  quickName: string
  onQuickNameChange: (value: string) => void
  quickType: ExamType
  onQuickTypeChange: (value: ExamType) => void
  quickDate: string
  onQuickDateChange: (value: string) => void
  quickCreating: boolean
  examTypes: Array<{ value: ExamType; label: string }>
  onCreate: () => void
  onCancel: () => void
}

export function QuickCreateExamCard({
  quickName,
  onQuickNameChange,
  quickType,
  onQuickTypeChange,
  quickDate,
  onQuickDateChange,
  quickCreating,
  examTypes,
  onCreate,
  onCancel,
}: QuickCreateExamCardProps) {
  const { t } = useT()

  return (
    <Card padding="lg">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
        {t('page.academics.entry.quickCreateExam', '快速创建考试')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('page.academics.exams.nameLabel', '考试名称')}{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={quickName}
            onChange={(e) => onQuickNameChange(e.target.value)}
            placeholder={t('page.academics.entry.quickNamePlaceholder', '如: 第一次月考')}
            className={cn(INPUT_BASE, 'w-full')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('page.academics.exams.typeLabel', '考试类型')}
          </label>
          <select
            value={quickType}
            onChange={(e) => onQuickTypeChange(e.target.value as ExamType)}
            className={cn(INPUT_BASE, 'w-full')}
          >
            {examTypes.map((et) => (
              <option key={et.value} value={et.value}>
                {t(`page.academics.examType.${et.value}`, et.label)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('page.academics.exams.dateLabel', '考试日期')}{' '}
            <span className="text-gray-400">({t('common.optional', '可选')})</span>
          </label>
          <input
            type="date"
            value={quickDate}
            onChange={(e) => onQuickDateChange(e.target.value)}
            className={cn(INPUT_BASE, 'w-full')}
          />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <Button onClick={onCreate} loading={quickCreating} disabled={!quickName.trim()}>
          {quickCreating
            ? t('page.academics.exams.creating', '创建中...')
            : t('page.academics.entry.createAndEnter', '创建并录入')}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-100 dark:bg-surface-tertiary hover:bg-gray-200 dark:hover:bg-white/[0.06] text-gray-600 dark:text-gray-400 px-4 py-2 rounded-lg text-sm transition-colors"
        >
          {t('common.cancel', '取消')}
        </button>
      </div>
    </Card>
  )
}
