// =============================================================
// DoctorCard — EAA 健康检查卡片
// 触发 doctor 诊断并展示健康状态 / 通过失败数 / 问题列表
// 卡壳(容器/标题/运行按钮/空态)见 ./DiagnosticsCardShell
// =============================================================

import type { EAADoctorData } from '@shared/types'
import { useT } from '../../../i18n'
import { DiagnosticsCardShell } from './DiagnosticsCardShell'

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
    <DiagnosticsCardShell
      dotClass="bg-green-500"
      title={t('page.dashboard.sysmgmt.doctor')}
      data={data}
      onRun={onRun}
      running={running}
      runLabel={t('page.dashboard.sysmgmt.doctor.run')}
      runningLabel={t('page.dashboard.sysmgmt.doctor.running')}
    >
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${data?.healthy ? 'bg-green-500' : 'bg-red-500'}`}
          ></span>
          <span
            className={
              data?.healthy
                ? 'text-green-600 dark:text-green-400 font-medium'
                : 'text-red-600 dark:text-red-400 font-medium'
            }
          >
            {data?.healthy
              ? t('page.dashboard.sysmgmt.doctor.healthy')
              : t('page.dashboard.sysmgmt.doctor.unhealthy')}
          </span>
        </div>
        <div className="flex gap-3 text-gray-500 dark:text-gray-400">
          <span>
            {t('page.dashboard.sysmgmt.doctor.passed')}:{' '}
            <span className="font-mono text-green-600 dark:text-green-400">{data?.passed}</span>
          </span>
          <span>
            {t('page.dashboard.sysmgmt.doctor.failed')}:{' '}
            <span className="font-mono text-red-600 dark:text-red-400">{data?.failed}</span>
          </span>
        </div>
        {(data?.issues.length ?? 0) > 0 && (
          <div className="mt-1 space-y-0.5">
            {data?.issues.map((issue) => (
              <div key={issue} className="text-red-500 dark:text-red-400 truncate" title={issue}>
                • {issue}
              </div>
            ))}
          </div>
        )}
      </div>
    </DiagnosticsCardShell>
  )
}
