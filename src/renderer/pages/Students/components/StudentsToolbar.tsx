// =============================================================
// 学生列表筛选+批量操作工具栏 — 从 StudentsPage 提取（纯展示组件）
// 班级下拉 / 搜索框 / 显示已存档 checkbox / 批量模式操作区
// =============================================================

import type { ClassEntity } from '@shared/types'
import { CheckSquare } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'
import { cn, INPUT_BASE } from '../../../lib/ui-utils'

interface StudentsToolbarProps {
  /** 班级筛选值（__ALL__ / __NONE__ / class_id） */
  classFilter: string
  onClassFilterChange: (value: string) => void
  /** 搜索词 */
  search: string
  onSearchChange: (value: string) => void
  /** 被隐藏的已存档班级学生数（>0 时显示"显示已存档"checkbox） */
  archivedHiddenCount: number
  showArchivedClass: boolean
  onShowArchivedClassChange: (value: boolean) => void
  /** 活跃班级列表（筛选下拉 + 批量调班目标下拉） */
  activeClassList: ClassEntity[]
  /** 批量选择模式 */
  selectMode: boolean
  onEnterSelectMode: () => void
  /** 已选中学生数 */
  selectedCount: number
  /** 批量调班目标班级 */
  batchAssignTarget: string
  onBatchAssignTargetChange: (value: string) => void
  batchAssigning: boolean
  batchDeleting: boolean
  onBatchAssign: () => void
  onBatchDelete: () => void
  onExitSelectMode: () => void
}

export function StudentsToolbar({
  classFilter,
  onClassFilterChange,
  search,
  onSearchChange,
  archivedHiddenCount,
  showArchivedClass,
  onShowArchivedClassChange,
  activeClassList,
  selectMode,
  onEnterSelectMode,
  selectedCount,
  batchAssignTarget,
  onBatchAssignTargetChange,
  batchAssigning,
  batchDeleting,
  onBatchAssign,
  onBatchDelete,
  onExitSelectMode,
}: StudentsToolbarProps) {
  const { t } = useT()

  return (
    <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50/50 dark:bg-surface-tertiary/30">
      {/* 班级筛选下拉 */}
      <select
        value={classFilter}
        onChange={(e) => onClassFilterChange(e.target.value)}
        className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
        title={t('page.students.toolbar.filterByClass', '按班级筛选')}
      >
        <option value="__ALL__">{t('page.students.toolbar.allClasses', '全部班级')}</option>
        <option value="__NONE__">{t('page.students.unassignedClass', '未分班')}</option>
        {activeClassList.map((c) => (
          <option key={c.id} value={c.class_id}>
            {c.name} ({c.class_id})
          </option>
        ))}
      </select>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t('page.students.search.placeholder', '搜索姓名/分组/角色...')}
        className={cn(INPUT_BASE, 'w-48 px-3 py-1.5 text-sm')}
      />
      {archivedHiddenCount > 0 && (
        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchivedClass}
            onChange={(e) => onShowArchivedClassChange(e.target.checked)}
            className="accent-blue-500"
          />
          {t('page.students.showArchived')}
        </label>
      )}
      {selectMode ? (
        <>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('page.students.batch.selected').replace('{0}', String(selectedCount))}
          </span>
          {/* 批量调班 */}
          <select
            value={batchAssignTarget}
            onChange={(e) => onBatchAssignTargetChange(e.target.value)}
            className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
            title={t('page.students.toolbar.selectTargetClass', '选择目标班级')}
          >
            <option value="">{t('page.students.toolbar.assignTarget', '调入班级...')}</option>
            {activeClassList.map((c) => (
              <option key={c.id} value={c.class_id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            onClick={onBatchAssign}
            disabled={selectedCount === 0 || !batchAssignTarget || batchAssigning}
            aria-label={t('page.students.toolbar.assign', '调入')}
          >
            {batchAssigning
              ? t('common.loading', '加载中...')
              : t('page.students.toolbar.assign', '调入')}
          </Button>
          <Button
            variant="danger"
            onClick={onBatchDelete}
            disabled={selectedCount === 0 || batchDeleting}
            aria-label={t('page.students.batch.delete')}
          >
            {batchDeleting
              ? t('common.loading')
              : `${t('page.students.batch.delete')} (${selectedCount})`}
          </Button>
          <Button
            variant="secondary"
            onClick={onExitSelectMode}
            aria-label={t('page.students.batch.cancel')}
          >
            {t('page.students.batch.cancel')}
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          onClick={onEnterSelectMode}
          icon={<CheckSquare size={14} />}
          aria-label={t('page.students.batch.select')}
        >
          {t('page.students.batch.select')}
        </Button>
      )}
    </div>
  )
}
