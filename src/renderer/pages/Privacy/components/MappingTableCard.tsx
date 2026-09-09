// =============================================================
// MappingTableCard — 隐私映射表卡片(前 50 条预览)
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
import { tr, useT } from '../../../i18n'
import { cn, TABLE_ROW, TABLE_TD, TABLE_TH } from '../../../lib/ui-utils'
import type { PrivacyMapping } from '../lib/privacy-mappings'

interface MappingTableCardProps {
  mappings: PrivacyMapping[]
}

export function MappingTableCard({ mappings }: MappingTableCardProps) {
  const { t } = useT()
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <h2 className="font-semibold mb-3">{t('page.privacy.mapping.title')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TABLE_TH}>{t('page.privacy.mapping.thType')}</th>
              <th className={TABLE_TH}>{t('page.privacy.mapping.thAlias')}</th>
              <th className={TABLE_TH}>{t('page.privacy.mapping.thReal')}</th>
            </tr>
          </thead>
          <tbody>
            {mappings.slice(0, 50).map((m) => (
              // P2-7: 组合 stable key(entityType + pseudonym)
              <tr key={`${m.entityType}-${m.pseudonym}`} className={TABLE_ROW}>
                <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>{m.entityType}</td>
                <td className={cn(TABLE_TD, 'font-mono text-blue-500 dark:text-blue-400')}>
                  {m.pseudonym}
                </td>
                <td className={TABLE_TD}>{m.realName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mappings.length > 50 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {tr('page.privacy.mapping.showingFirst', { total: mappings.length })}
        </div>
      )}
    </Card>
  )
}
