// =============================================================
// MaintenanceActionsCard — 维护工具操作卡片
// 事件重放 + 导出 HTML 仪表盘
// =============================================================

import { FileOutput, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Card } from '../../../components/Card'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
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
  const [confirmReplay, setConfirmReplay] = useState(false)
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
            onClick={() => setConfirmReplay(true)}
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
      {/* 事件重放会基于全量事件重建排行榜/统计缓存,属批量写操作,需二次确认 */}
      <ConfirmDialog
        open={confirmReplay}
        title={t('page.dashboard.sysmgmt.replay')}
        message="事件重放将基于全部事件日志重建排行榜与统计缓存,耗时随事件数量增长。确定要继续吗?"
        confirmText="开始重放"
        onConfirm={() => {
          setConfirmReplay(false)
          onReplay()
        }}
        onCancel={() => setConfirmReplay(false)}
      />
    </Card>
  )
}
