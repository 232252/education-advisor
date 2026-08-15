// =============================================================
// MaintenanceActionsCard — 维护工具操作卡片
// 事件重放 + 导出 HTML 仪表盘
// =============================================================

import { FileOutput, RefreshCw } from 'lucide-react'
import { Card } from '../../../components/Card'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'

export function MaintenanceActionsCard({
  onReplay,
  onExportHtml,
}: {
  onReplay: () => void
  onExportHtml: () => void
}) {
  const { t } = useT()
  return (
    <Card padding="md" className="col-span-2 shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
        {t('common.action', '维护工具')}
      </h3>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReplay}
            className={btnStyle('primary')}
            aria-label={t('page.dashboard.sysmgmt.replay')}
          >
            <RefreshCw size={16} strokeWidth={2} /> {t('page.dashboard.sysmgmt.replay')}
          </button>
          <button
            type="button"
            onClick={onExportHtml}
            className={btnStyle('secondary')}
            aria-label="导出 HTML 仪表盘"
          >
            <FileOutput size={16} strokeWidth={2} /> 导出 HTML 仪表盘
          </button>
        </div>
      </div>
    </Card>
  )
}
