// =============================================================
// DashboardToolbar — 仪表盘页头操作区
// 班级筛选下拉 + 班级对比模式开关 + 手动刷新按钮
// =============================================================

import type { ClassEntity } from '@shared/types'
import { useT } from '../../../i18n'
import { btnStyle, INPUT_BASE } from '../../../lib/ui-utils'

export function DashboardToolbar({
  classFilter,
  onClassFilterChange,
  activeClassList,
  compareMode,
  onCompareModeToggle,
  onRefresh,
}: {
  classFilter: string
  onClassFilterChange: (value: string) => void
  activeClassList: ClassEntity[]
  compareMode: boolean
  onCompareModeToggle: () => void
  onRefresh: () => void
}) {
  const { t } = useT()
  return (
    <>
      {/* 班级筛选 */}
      <select
        value={classFilter}
        onChange={(e) => onClassFilterChange(e.target.value)}
        className={INPUT_BASE}
        title="按班级筛选数据"
        aria-label="按班级筛选数据"
      >
        <option value="__ALL__">全部班级</option>
        <option value="__NONE__">未分班</option>
        {activeClassList.map((c) => (
          <option key={c.id} value={c.class_id}>
            {c.name}
          </option>
        ))}
      </select>
      {/* 班级对比模式开关 */}
      <button
        type="button"
        onClick={onCompareModeToggle}
        className={btnStyle(compareMode ? 'primary' : 'secondary')}
        title="班级对比模式"
        aria-label="班级对比模式"
      >
        班级对比
      </button>
      <button type="button" onClick={onRefresh} className={btnStyle('ghost')} aria-label="刷新数据">
        {t('page.dashboard.refresh')}
      </button>
    </>
  )
}
