// =============================================================
// TagsOverviewCard — 标签概览卡片
// 展示 EAA 数据中已有标签及其数量
// =============================================================

import type { EAATagListData } from '@shared/types'
import { Tags } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'

export function TagsOverviewCard({ tagData }: { tagData: EAATagListData | null }) {
  const { t } = useT()
  return (
    <Card padding="md" className="shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
        {t('page.dashboard.sysmgmt.tags')}
      </h3>
      {tagData && tagData.tags.length > 0 ? (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {tagData.tags.map((item) => (
            <div key={item.tag} className="flex items-center justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-300 font-mono bg-gray-100 dark:bg-white/[0.06] px-1.5 py-0.5 rounded">
                {item.tag}
              </span>
              <span className="text-gray-500 dark:text-gray-400 font-mono">{item.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Tags size={28} />}
          title={t('page.dashboard.sysmgmt.noData')}
          className="py-4"
        />
      )}
    </Card>
  )
}
