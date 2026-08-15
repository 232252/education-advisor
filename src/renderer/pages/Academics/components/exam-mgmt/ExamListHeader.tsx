// =============================================================
// 考试列表头部 — 标题 + 考试计数 + 创建/取消按钮
// =============================================================

import { btnStyle } from '../../../../lib/ui-utils'

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
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">考试列表</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">共 {examCount} 场考试</p>
      </div>
      <button type="button" onClick={onToggleCreateForm} className={btnStyle('primary')}>
        {showCreateForm ? '取消' : '+ 创建考试'}
      </button>
    </div>
  )
}
