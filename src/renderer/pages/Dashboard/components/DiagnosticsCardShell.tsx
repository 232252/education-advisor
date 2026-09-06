// =============================================================
// DiagnosticsCardShell — Dashboard 诊断/信息三卡公共壳
// 卡片容器 + 彩点标题 + 空态兜底三件套,Doctor/Validate/EaaInfo
// 三卡仅标题、点色与内容体不同;运行卡额外注入运行按钮。
// =============================================================

import { Inbox, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { btnStyle } from '../../../lib/ui-utils'

interface DiagnosticsCardShellProps {
  /** 标题圆点色(bg-green-500 等) */
  dotClass: string
  title: string
  /** 数据;null 时渲染统一空态 */
  data: unknown
  /** 运行卡: 传入即渲染运行按钮(loading 态随 running) */
  onRun?: () => void
  running?: boolean
  runLabel?: string
  runningLabel?: string
  children: ReactNode
}

export function DiagnosticsCardShell({
  dotClass,
  title,
  data,
  onRun,
  running,
  runLabel,
  runningLabel,
  children,
}: DiagnosticsCardShellProps) {
  const { t } = useT()
  return (
    <Card padding="md" className="shadow-card">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
        {title}
      </h3>
      {onRun && (
        <div className="mb-3">
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className={btnStyle('primary')}
            aria-label={runLabel}
          >
            {running && <Loader2 className="animate-spin" size={14} />}
            {running ? runningLabel : runLabel}
          </button>
        </div>
      )}
      {data ? (
        children
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
