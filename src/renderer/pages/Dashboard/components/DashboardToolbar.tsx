// =============================================================
// DashboardToolbar — 仪表盘页头操作区
// 班级筛选下拉 + 班级对比模式开关 + 手动刷新按钮
// =============================================================

import type { ClassEntity } from '@shared/types'
import { ClassFilterSelect } from '../../../components/ClassFilterSelect'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'

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
      <ClassFilterSelect
        value={classFilter}
        onChange={onClassFilterChange}
        classes={activeClassList}
        allLabel={t('page.academics.class.all', '全部班级')}
        noneLabel={t('page.classes.profile.unassigned', '未分班')}
        title={t('page.students.toolbar.filterByClass', '按班级筛选')}
      />
      {/* 班级对比模式开关 */}
      <button
        type="button"
        onClick={onCompareModeToggle}
        className={btnStyle(compareMode ? 'primary' : 'secondary')}
        title={t('page.dashboard.compareModeTitle')}
        aria-label={t('page.dashboard.compareModeTitle')}
      >
        {t('page.dashboard.compareMode')}
      </button>
      <button
        type="button"
        onClick={onRefresh}
        className={btnStyle('ghost')}
        aria-label={t('page.dashboard.ariaRefreshData')}
      >
        {t('page.dashboard.refresh')}
      </button>
    </>
  )
}
