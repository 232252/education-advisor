// =============================================================
// EaaInfoCard — EAA 系统信息卡片
// 版本 / 学生数 / 事件数 / 数据目录
// =============================================================

import type { EAAInfoData } from '@shared/types'
import { Inbox } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'

export function EaaInfoCard({ info }: { info: EAAInfoData | null }) {
  const { t } = useT()
  return (
    <Card padding="md" className="shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
        {t('page.dashboard.sysmgmt.info')}
      </h3>
      {info ? (
        <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex justify-between">
            <span>{t('page.dashboard.sysmgmt.info.version')}</span>
            <span className="font-mono text-gray-700 dark:text-gray-300">{info.version}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('page.dashboard.sysmgmt.info.students')}</span>
            <span className="font-mono text-gray-700 dark:text-gray-300">{info.students}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('page.dashboard.sysmgmt.info.events')}</span>
            <span className="font-mono text-gray-700 dark:text-gray-300">{info.events}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('page.dashboard.sysmgmt.info.dataDir')}</span>
            <span
              className="font-mono text-gray-700 dark:text-gray-300 truncate ml-2"
              title={info.data_dir}
            >
              {info.data_dir}
            </span>
          </div>
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
