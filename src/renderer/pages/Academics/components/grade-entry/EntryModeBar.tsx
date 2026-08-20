// =============================================================
// 录入模式切换栏 — 单科/全科模式切换 + AI 智能录入入口按钮
// =============================================================

import type { GradeEntryMode } from '@shared/types'
import { useT } from '../../../../i18n'
import { cn } from '../../../../lib/ui-utils'

interface EntryModeBarProps {
  mode: GradeEntryMode
  onModeChange: (mode: GradeEntryMode) => void
  showAIEntry: boolean
  onToggleAIEntry: () => void
}

export function EntryModeBar({
  mode,
  onModeChange,
  showAIEntry,
  onToggleAIEntry,
}: EntryModeBarProps) {
  const { t } = useT()

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {t('page.academics.entry.modeLabel', '录入模式:')}
      </span>
      <div className="flex bg-gray-100 dark:bg-surface-tertiary rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => onModeChange('single-subject')}
          className={cn(
            'px-3 py-1.5 rounded-md text-xs transition-colors',
            mode === 'single-subject'
              ? 'bg-white dark:bg-surface-elevated text-blue-600 dark:text-blue-400 font-medium shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
          )}
        >
          📝 {t('page.academics.entry.singleSubject', '单科录入 (科任老师)')}
        </button>
        <button
          type="button"
          onClick={() => onModeChange('all-subjects')}
          className={cn(
            'px-3 py-1.5 rounded-md text-xs transition-colors',
            mode === 'all-subjects'
              ? 'bg-white dark:bg-surface-elevated text-blue-600 dark:text-blue-400 font-medium shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
          )}
        >
          📋 {t('page.academics.entry.allSubjects', '全科录入 (班主任)')}
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleAIEntry}
        className={cn(
          'ml-auto px-3 py-1.5 rounded-md text-xs transition-colors border',
          showAIEntry
            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700'
            : 'bg-gray-100 dark:bg-surface-tertiary text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.06] border-transparent',
        )}
        title={t('page.academics.entry.aiToggleTitle', '粘贴成绩文本,AI 自动解析并填充')}
      >
        🤖 {t('page.academics.entry.aiEntry', 'AI 智能录入')}
      </button>
    </div>
  )
}
