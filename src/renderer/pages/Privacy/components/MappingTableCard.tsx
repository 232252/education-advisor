// =============================================================
// MappingTableCard — 隐私映射表卡片(前 50 条预览)
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
import { cn, TABLE_ROW, TABLE_TD, TABLE_TH } from '../../../lib/ui-utils'
import type { PrivacyMapping } from '../lib/privacy-mappings'

interface MappingTableCardProps {
  mappings: PrivacyMapping[]
}

export function MappingTableCard({ mappings }: MappingTableCardProps) {
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <h2 className="font-semibold mb-3">映射表</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TABLE_TH}>类型</th>
              <th className={TABLE_TH}>化名</th>
              <th className={TABLE_TH}>真名</th>
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
          显示前 50 条，共 {mappings.length} 条
        </div>
      )}
    </Card>
  )
}
