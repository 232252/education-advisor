// =============================================================
// EaaInfoCard — EAA 系统信息卡片
// 版本 / 学生数 / 事件数 / 数据目录
// 卡壳(容器/标题/空态)见 ./DiagnosticsCardShell
// =============================================================

import type { EAAInfoData } from '@shared/types'
import { useT } from '../../../i18n'
import { DiagnosticsCardShell } from './DiagnosticsCardShell'

export function EaaInfoCard({ info }: { info: EAAInfoData | null }) {
  const { t } = useT()
  const rows: Array<[string, string]> = [
    [t('page.dashboard.sysmgmt.info.version'), info?.version ?? ''],
    [t('page.dashboard.sysmgmt.info.students'), info ? String(info.students) : ''],
    [t('page.dashboard.sysmgmt.info.events'), info ? String(info.events) : ''],
    [t('page.dashboard.sysmgmt.info.dataDir'), info?.data_dir ?? ''],
  ]
  return (
    <DiagnosticsCardShell
      dotClass="bg-blue-500"
      title={t('page.dashboard.sysmgmt.info')}
      data={info}
    >
      <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
        {rows.map(([label, value], i) => (
          <div key={label} className="flex justify-between">
            <span>{label}</span>
            <span
              className={`font-mono text-gray-700 dark:text-gray-300 ${i === rows.length - 1 ? 'truncate ml-2' : ''}`}
              title={i === rows.length - 1 ? value : undefined}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </DiagnosticsCardShell>
  )
}
