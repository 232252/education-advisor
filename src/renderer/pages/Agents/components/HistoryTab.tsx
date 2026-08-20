// =============================================================
// 历史 Tab — 执行记录列表（倒序）+ 行展开详情
// =============================================================

import type { AgentExecution } from '@shared/types'
import { ClipboardList } from 'lucide-react'
import { memo, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { Markdown } from '../../../components/Markdown'
import { useT } from '../../../i18n'
import { cn, TABLE_ROW, TABLE_TD, TABLE_TH } from '../../../lib/ui-utils'
import { formatHistoryTime, sortExecutionsDesc } from '../lib/agent-display'

export function HistoryTab({ executions }: { executions: AgentExecution[] }) {
  const { t } = useT()
  if (executions.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList size={28} />}
        title={t('page.agents.history.empty', '暂无执行记录')}
      />
    )
  }

  // 按时间倒序
  const sorted = sortExecutionsDesc(executions)

  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={TABLE_TH}>{t('page.agents.history.col.time', '时间')}</th>
            <th className={TABLE_TH}>{t('page.agents.history.col.status', '状态')}</th>
            <th className={TABLE_TH}>{t('page.agents.history.col.prompt', '指令')}</th>
            <th className={TABLE_TH}>{t('page.agents.history.col.duration', '耗时')}</th>
            <th className={TABLE_TH}>Token</th>
            <th className={TABLE_TH}>{t('page.agents.history.col.cost', '费用')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((exec) => (
            <HistoryRow key={exec.id} exec={exec} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const HistoryRow = memo(function HistoryRow({ exec }: { exec: AgentExecution }) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  const timeStr = formatHistoryTime(exec.startedAt)

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} className={cn(TABLE_ROW, 'cursor-pointer')}>
        <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400 whitespace-nowrap')}>
          {timeStr}
        </td>
        <td className={TABLE_TD}>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              exec.status === 'success'
                ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                : exec.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
                  : 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400'
            }`}
          >
            {exec.status === 'success'
              ? t('common.success', '成功')
              : exec.status === 'error'
                ? t('common.error', '错误')
                : t('status.timeout', '超时')}
          </span>
        </td>
        <td className={cn(TABLE_TD, 'text-gray-600 dark:text-gray-300 truncate max-w-[200px]')}>
          {exec.prompt}
        </td>
        <td className={cn(TABLE_TD, 'text-gray-400 dark:text-gray-500 whitespace-nowrap')}>
          {(exec.durationMs / 1000).toFixed(1)}s
        </td>
        <td className={cn(TABLE_TD, 'text-gray-400 dark:text-gray-500 whitespace-nowrap')}>
          {exec.tokenUsage.inputTokens + exec.tokenUsage.outputTokens}
        </td>
        <td className={cn(TABLE_TD, 'text-gray-400 dark:text-gray-500 whitespace-nowrap')}>
          ${exec.cost.toFixed(4)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-white/[0.03]">
          <td colSpan={6} className="p-4">
            <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">
              {t('page.agents.history.input', '输入')}: {exec.prompt}
            </div>
            {exec.output ? (
              <div className="text-xs text-gray-600 dark:text-gray-300 max-h-60 overflow-y-auto">
                <Markdown content={exec.output} />
              </div>
            ) : (
              <div className="text-xs text-gray-400 dark:text-gray-500 italic">
                {t('page.agents.history.noOutput', '（无输出）')}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
})
