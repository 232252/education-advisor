// =============================================================
// 班级列表表格 — 行点击查看详情 / 行内编辑/存档/恢复/删除 / 右键菜单
// =============================================================

import type { ClassEntity } from '@shared/types'
import { useT } from '../../../i18n'
import {
  btnStyle,
  cn,
  TABLE_ROW,
  TABLE_STICKY_HEAD,
  TABLE_TD,
  TABLE_TH,
} from '../../../lib/ui-utils'
import type { ClassCountMap } from '../hooks/useClassesData'

interface ClassTableProps {
  classes: ClassEntity[]
  counts: ClassCountMap
  selectedClassId?: string
  /** 构造右键菜单 JSON（页面 memo 化） */
  buildCtxMenu: (archived: boolean) => string
  onSelect: (c: ClassEntity) => void
  onEdit: (c: ClassEntity) => void
  onArchive: (c: ClassEntity) => void
  onRestore: (c: ClassEntity) => void
  onDelete: (c: ClassEntity) => void
}

/** 班级列表表格（不含 loading/空状态分支） */
export function ClassTable({
  classes,
  counts,
  selectedClassId,
  buildCtxMenu,
  onSelect,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: ClassTableProps) {
  const { t } = useT()

  return (
    <table className="w-full text-sm">
      <thead className={TABLE_STICKY_HEAD}>
        <tr>
          <th className={TABLE_TH}>{t('page.classes.col.classId')}</th>
          <th className={TABLE_TH}>{t('page.classes.col.name')}</th>
          <th className={TABLE_TH}>{t('page.classes.col.grade')}</th>
          <th className={TABLE_TH}>{t('page.classes.col.teacher')}</th>
          <th className={cn(TABLE_TH, 'text-center')}>{t('page.classes.col.students')}</th>
          <th className={TABLE_TH}>{t('page.classes.col.status')}</th>
          <th className={cn(TABLE_TH, 'text-center')}>{t('page.classes.col.action')}</th>
        </tr>
      </thead>
      <tbody>
        {classes.map((c) => (
          <tr
            key={c.id}
            data-ctx-menu={buildCtxMenu(c.archived)}
            data-ctx-class-id={c.id}
            onClick={() => onSelect(c)}
            className={cn(
              TABLE_ROW,
              'cursor-pointer',
              c.archived && 'opacity-60',
              selectedClassId === c.id && 'bg-blue-600/10 border-l-2 border-l-blue-400',
            )}
          >
            <td className={cn(TABLE_TD, 'font-mono text-xs text-gray-600 dark:text-gray-300')}>
              {c.class_id}
            </td>
            <td className={cn(TABLE_TD, 'font-medium')}>{c.name}</td>
            <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>
              {c.grade || t('common.dash')}
            </td>
            <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>
              {c.teacher || t('common.dash')}
            </td>
            <td className={cn(TABLE_TD, 'text-center text-gray-500 dark:text-gray-400')}>
              {counts[c.class_id] ?? 0}
            </td>
            <td className={TABLE_TD}>
              {c.archived ? (
                <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-surface-elevated text-gray-500 dark:text-gray-400">
                  {t('page.classes.status.archived')}
                </span>
              ) : (
                <span className="inline-block px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                  {t('page.classes.status.active')}
                </span>
              )}
            </td>
            <td className={TABLE_TD} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onEdit(c)}
                  aria-label={t('page.classes.edit')}
                  className={btnStyle('ghost')}
                >
                  {t('page.classes.edit')}
                </button>
                {c.archived ? (
                  <button
                    type="button"
                    onClick={() => onRestore(c)}
                    aria-label={t('page.classes.restore')}
                    className={btnStyle('ghost')}
                  >
                    {t('page.classes.restore')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onArchive(c)}
                    aria-label={t('page.classes.archive')}
                    className={btnStyle('ghost')}
                  >
                    {t('page.classes.archive')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  aria-label={t('page.classes.delete')}
                  className={btnStyle('ghost')}
                >
                  {t('page.classes.delete')}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
