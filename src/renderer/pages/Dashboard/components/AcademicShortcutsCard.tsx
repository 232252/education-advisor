// =============================================================
// AcademicShortcutsCard — 学业四入口（总览/考试/录入/对比）
// 跳到 /academics?tab=...，与学业页 Tabs 同一套 key。
// =============================================================

import { BarChart3, ClipboardList, PencilLine, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../../components/Card'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'

const SHORTCUTS: Array<{
  tab: 'overview' | 'exams' | 'entry' | 'compare'
  icon: typeof BarChart3
  labelKey: string
}> = [
  { tab: 'overview', icon: BarChart3, labelKey: 'page.academics.tab.overview' },
  { tab: 'exams', icon: ClipboardList, labelKey: 'page.academics.tab.exams' },
  { tab: 'entry', icon: PencilLine, labelKey: 'page.academics.tab.entry' },
  { tab: 'compare', icon: TrendingUp, labelKey: 'page.academics.tab.compare' },
]

export function AcademicShortcutsCard() {
  const { t } = useT()
  const navigate = useNavigate()
  return (
    <Card padding="md" className="shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
        {t('page.dashboard.academic.shortcuts')}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {SHORTCUTS.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.tab}
              onClick={() => navigate(`/academics?tab=${item.tab}`)}
              className={`${btnStyle('secondary')} justify-center`}
              aria-label={t(item.labelKey)}
            >
              <Icon size={14} strokeWidth={2} />
              {t(item.labelKey)}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
