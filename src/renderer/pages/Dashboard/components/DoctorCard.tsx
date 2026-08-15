// =============================================================
// DoctorCard — EAA 健康检查卡片
// 触发 doctor 诊断并展示健康状态 / 通过失败数 / 问题列表
// =============================================================

import type { EAADoctorData } from '@shared/types'
import { Inbox, Loader2 } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'

export function DoctorCard({
  data,
  running,
  onRun,
}: {
  data: EAADoctorData | null
  running: boolean
  onRun: () => void
}) {
  const { t } = useT()
  return (
    <Card padding="md" className="shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
        {t('page.dashboard.sysmgmt.doctor')}
      </h3>
      <div className="mb-3">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className={btnStyle('primary')}
          aria-label={t('page.dashboard.sysmgmt.doctor.run')}
        >
          {running && <Loader2 className="animate-spin" size={14} />}
          {running
            ? t('page.dashboard.sysmgmt.doctor.running')
            : t('page.dashboard.sysmgmt.doctor.run')}
        </button>
      </div>
      {data ? (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${data.healthy ? 'bg-green-500' : 'bg-red-500'}`}
            ></span>
            <span
              className={
                data.healthy
                  ? 'text-green-600 dark:text-green-400 font-medium'
                  : 'text-red-600 dark:text-red-400 font-medium'
              }
            >
              {data.healthy
                ? t('page.dashboard.sysmgmt.doctor.healthy')
                : t('page.dashboard.sysmgmt.doctor.unhealthy')}
            </span>
          </div>
          <div className="flex gap-3 text-gray-500 dark:text-gray-400">
            <span>
              {t('page.dashboard.sysmgmt.doctor.passed')}:{' '}
              <span className="font-mono text-green-600 dark:text-green-400">{data.passed}</span>
            </span>
            <span>
              {t('page.dashboard.sysmgmt.doctor.failed')}:{' '}
              <span className="font-mono text-red-600 dark:text-red-400">{data.failed}</span>
            </span>
          </div>
          {data.issues.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {data.issues.map((issue) => (
                <div key={issue} className="text-red-500 dark:text-red-400 truncate" title={issue}>
                  • {issue}
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
