// =============================================================
// ValidateCard — EAA 数据验证卡片
// 触发 validate 校验并展示校验状态 / 错误 / 警告
// =============================================================

import type { EAAValidateData } from '@shared/types'
import { Inbox, Loader2 } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'

export function ValidateCard({
  data,
  running,
  onRun,
}: {
  data: EAAValidateData | null
  running: boolean
  onRun: () => void
}) {
  const { t } = useT()
  return (
    <Card padding="md" className="shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
        {t('page.dashboard.sysmgmt.validate')}
      </h3>
      <div className="mb-3">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className={btnStyle('primary')}
          aria-label={t('page.dashboard.sysmgmt.validate.run')}
        >
          {running && <Loader2 className="animate-spin" size={14} />}
          {running
            ? t('page.dashboard.sysmgmt.validate.running')
            : t('page.dashboard.sysmgmt.validate.run')}
        </button>
      </div>
      {data ? (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${data.valid ? 'bg-green-500' : 'bg-red-500'}`}
            ></span>
            <span
              className={
                data.valid
                  ? 'text-green-600 dark:text-green-400 font-medium'
                  : 'text-red-600 dark:text-red-400 font-medium'
              }
            >
              {data.valid
                ? t('page.dashboard.sysmgmt.validate.valid')
                : t('page.dashboard.sysmgmt.validate.invalid')}
            </span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto">
              {data.total_events} events
            </span>
          </div>
          {data.errors.length > 0 && (
            <div>
              <div className="text-red-500 dark:text-red-400 font-medium mb-0.5">
                {t('page.dashboard.sysmgmt.validate.errors')} ({data.errors.length})
              </div>
              {data.errors.slice(0, 3).map((e) => (
                <div key={e} className="text-red-400 dark:text-red-500 truncate" title={e}>
                  • {e}
                </div>
              ))}
            </div>
          )}
          {data.warnings.length > 0 && (
            <div>
              <div className="text-yellow-500 dark:text-yellow-400 font-medium mb-0.5">
                {t('page.dashboard.sysmgmt.validate.warnings')} ({data.warnings.length})
              </div>
              {data.warnings.slice(0, 3).map((w) => (
                <div key={w} className="text-yellow-400 dark:text-yellow-500 truncate" title={w}>
                  • {w}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Inbox size={28} />}
          title={t('page.dashboard.sysmgmt.noData')}
          className="py-4"
        />
      )}
    </Card>
  )
}
