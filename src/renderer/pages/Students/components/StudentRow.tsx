// =============================================================
// 学生表格行组件 — 从 StudentsPage 提取
// P 优化: memo 组件,避免点击切换选中时整表重渲染
// =============================================================

import type { EAAStudent } from '@shared/types'
import { memo } from 'react'
import { useT } from '../../../i18n'
import { cn, riskColor, TABLE_ROW, TABLE_TD } from '../../../lib/ui-utils'

// P 优化: 将表格行抽成 memo 组件,避免点击切换选中时整表重渲染
interface StudentRowProps {
  student: EAAStudent
  isSelected: boolean
  isSelectMode: boolean
  isChecked: boolean
  classNameLabel: string | null
  ctxMenuJson: string
  onSelect: (s: EAAStudent) => void
  onToggleCheck: (name: string) => void
  onDelete: (name: string) => void
}

export const StudentRow = memo(function StudentRow({
  student: s,
  isSelected,
  isSelectMode,
  isChecked,
  classNameLabel,
  ctxMenuJson,
  onSelect,
  onToggleCheck,
  onDelete,
}: StudentRowProps) {
  const { t } = useT()
  return (
    <tr
      data-ctx-menu={ctxMenuJson}
      data-ctx-student-name={s.name}
      onClick={() => (isSelectMode ? onToggleCheck(s.name) : onSelect(s))}
      className={cn(
        'cursor-pointer',
        isSelectMode && isChecked
          ? 'border-b border-gray-100 dark:border-white/[0.06] transition-colors bg-blue-600/10 border-l-2 border-l-blue-400'
          : isSelected
            ? 'border-b border-gray-100 dark:border-white/[0.06] transition-colors bg-blue-600/20 border-l-2 border-l-blue-400'
            : TABLE_ROW,
      )}
    >
      {isSelectMode && (
        <td className={TABLE_TD} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleCheck(s.name)}
            className="accent-blue-500 cursor-pointer"
          />
        </td>
      )}
      <td className={cn(TABLE_TD, 'font-medium')}>{s.name}</td>
      <td className={cn(TABLE_TD, 'text-xs text-gray-500 dark:text-gray-400')}>
        {s.class_id ? (
          <span className="bg-gray-100 dark:bg-surface-elevated px-1.5 py-0.5 rounded">
            {classNameLabel ?? s.class_id}
          </span>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">
            {t('page.students.unassignedClass', '未分班')}
          </span>
        )}
      </td>
      <td className={cn(TABLE_TD, 'text-right font-mono')}>{s.score.toFixed(1)}</td>
      <td
        className={cn(
          TABLE_TD,
          'text-right font-mono text-xs',
          s.delta > 0
            ? 'text-green-500 dark:text-green-400'
            : s.delta < 0
              ? 'text-red-500 dark:text-red-400'
              : 'text-gray-400 dark:text-gray-500',
        )}
      >
        {s.delta > 0 ? '+' : ''}
        {s.delta.toFixed(1)}
      </td>
      <td className={cn(TABLE_TD, 'text-center', riskColor(s.risk))}>{s.risk}</td>
      <td className={cn(TABLE_TD, 'text-center text-gray-500 dark:text-gray-400')}>
        {s.events_count}
      </td>
      <td className={TABLE_TD}>
        <div className="flex gap-1 flex-wrap">
          {s.groups.map((g) => (
            <span
              key={g}
              className="text-[10px] bg-gray-200 dark:bg-surface-elevated px-1.5 py-0.5 rounded"
            >
              {g}
            </span>
          ))}
          {s.roles.map((r) => (
            <span
              key={r}
              className="text-[10px] bg-blue-500/20 text-blue-500 dark:text-blue-400 px-1.5 py-0.5 rounded"
            >
              {r}
            </span>
          ))}
        </div>
      </td>
      <td className={cn(TABLE_TD, 'text-center')}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(s.name)
          }}
          className="text-red-400/50 hover:text-red-500 dark:hover:text-red-400 text-xs transition-colors"
          title={t('page.students.deleteStudent', '删除学生')}
          aria-label={t('page.students.deleteStudent', '删除学生')}
        >
          {t('page.students.delete', '删除')}
        </button>
      </td>
    </tr>
  )
})
