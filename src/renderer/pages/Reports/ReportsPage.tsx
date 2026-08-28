// =============================================================
// 报告中心页面(R2-12) — 左列表 / 右 Markdown 预览 / 空态一键生成
// 消费 data_archive/agent_outputs/:周报/风险汇总/谈话计划等 agent 产物
// =============================================================

import type { ReportEntry } from '@shared/types/reports'
import { FileText, Play, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { Markdown } from '../../components/Markdown'
import { PageHeader } from '../../components/PageHeader'
import { Skeleton } from '../../components/Skeleton'
import { useT } from '../../i18n'
import { formatBytes, formatDateTime } from '../../lib/ui-utils'
import { useReportsData } from './hooks/useReportsData'

export function ReportsPage() {
  const { t } = useT()
  const {
    entries,
    loading,
    error,
    selectedName,
    content,
    contentLoading,
    generating,
    select,
    fetchList,
    generateNow,
  } = useReportsData()

  const sorted = useMemo(() => entries, [entries])

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <PageHeader
        title={t('nav.reports', '报告中心')}
        subtitle={t(
          'page.reports.subtitle',
          'AI 生成的周报、风险汇总与谈话计划产物(每周五自动生成,可一键补跑)',
        )}
        actions={[
          <Button
            type="button"
            key="generate"
            onClick={() => void generateNow()}
            disabled={generating}
            variant="primary"
            size="sm"
          >
            <Play size={13} />
            {generating
              ? t('page.reports.generating', '正在生成…')
              : t('page.reports.generateNow', '立即生成周报')}
          </Button>,
          <button
            type="button"
            key="refresh"
            onClick={() => void fetchList()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
          >
            <RefreshCw size={13} />
            {t('common.refresh', '刷新')}
          </button>,
        ]}
      />

      <div className="flex-1 flex min-h-0 px-5 pb-5 gap-4">
        {/* 左:产物列表 */}
        <div className="w-72 flex-shrink-0 flex flex-col rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary min-h-0">
          <div className="px-3 py-2 border-b border-gray-200/70 dark:border-white/[0.06] text-[11px] text-gray-400 dark:text-gray-500 font-medium">
            {loading
              ? t('common.loading', '加载中…')
              : t('page.reports.count', `共 ${sorted.length} 份`)}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素
                <Skeleton key={`s-${i}`} className="h-10 w-full rounded-lg" />
              ))
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={<FileText size={26} />}
                title={t('page.reports.empty', '暂无报告产物')}
                description={t(
                  'page.reports.emptyDesc',
                  '点击右上角"立即生成周报",或等待周五定时任务自动产出。',
                )}
              />
            ) : (
              sorted.map((e) => (
                <ReportRow
                  key={e.name}
                  entry={e}
                  selected={e.name === selectedName}
                  onSelect={() => void select(e.name)}
                />
              ))
            )}
          </div>
          {error && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 border-t border-red-200/50 dark:border-red-400/20">
              {error}
            </div>
          )}
        </div>

        {/* 右:预览 */}
        <div className="flex-1 rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary overflow-y-auto p-5 min-w-0">
          {contentLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : selectedName && content ? (
            <>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-3 font-mono">
                {selectedName}
              </div>
              <Markdown content={content} />
            </>
          ) : (
            <EmptyState
              icon={<FileText size={28} />}
              title={t('page.reports.previewEmpty', '选择左侧产物查看')}
              description={t(
                'page.reports.previewEmptyDesc',
                '报告产物支持 Markdown/JSON/文本,可直接阅读或复制。',
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ReportRow({
  entry,
  selected,
  onSelect,
}: {
  entry: ReportEntry
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors ${
        selected
          ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
          : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
      }`}
    >
      <div className="text-xs font-medium truncate">{entry.name}</div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
        {formatDateTime(entry.mtimeMs)} · {formatBytes(entry.size)}
      </div>
    </button>
  )
}
