// =============================================================
// 事件选项卡 — 搜索 / 日期范围 / 撤销
// 支持关键词搜索、日期范围筛选、事件类型过滤、撤销事件
// =============================================================

import type { EAAEventRecord, EAAHistoryEvent, EAAReasonCode } from '@shared/types'
import { ClipboardList } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { EmptyState } from '../../../components/EmptyState'
import { useConfirmDialog } from '../../../hooks/useConfirmDialog'
import { useDebouncedCallback } from '../../../hooks/useDebouncedCallback'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { EventCard } from '../components'

/** 将 EAAEventRecord（search/range 返回）映射为 EAAHistoryEvent 兼容结构 */
function eventRecordToHistory(rec: EAAEventRecord): EAAHistoryEvent {
  return {
    event_id: rec.event_id,
    timestamp: rec.timestamp,
    event_type: rec.event_type,
    reason_code: rec.reason_code,
    score_delta: rec.score_delta,
    cumulative: 0, // search/range 结果无累计值
    note: rec.note,
    tags: rec.tags,
    reverted: !rec.is_valid, // is_valid=false 视为已撤销
  }
}

export function EventsTab({
  events,
  eventFilter,
  onFilterChange,
  timeRange,
  onTimeRangeChange,
  reasonCodes,
  studentName,
  searchQuery,
  onSearchQueryChange,
  dateStart,
  onDateStartChange,
  dateEnd,
  onDateEndChange,
  onRefresh,
}: {
  events: EAAHistoryEvent[]
  eventFilter: 'all' | 'bonus' | 'deduct'
  onFilterChange: (f: 'all' | 'bonus' | 'deduct') => void
  timeRange: 'all' | 'week' | 'month' | 'semester'
  onTimeRangeChange: (t: 'all' | 'week' | 'month' | 'semester') => void
  reasonCodes: EAAReasonCode[]
  studentName: string
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  dateStart: string
  onDateStartChange: (d: string) => void
  dateEnd: string
  onDateEndChange: (d: string) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  // 搜索/范围结果（替换 history 事件）
  const [searchEvents, setSearchEvents] = useState<EAAHistoryEvent[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  // 撤销确认对话框（接入 Phase 1 useConfirmDialog，payload = eventId）
  const revertDialog = useConfirmDialog<string>()

  // 实际展示的事件列表：有搜索/范围结果时用结果，否则用 props.events
  const displayEvents = searchEvents ?? events

  const performSearch = async (query: string, start: string, end: string) => {
    setSearchLoading(true)
    try {
      // 优先级：日期范围 > 关键词搜索
      if (start && end) {
        const result = await getAPI().eaa.range(start, end, 100)
        if (result.success && result.data?.events) {
          setSearchEvents(result.data.events.map(eventRecordToHistory))
        } else {
          setSearchEvents([])
        }
      } else if (query.trim()) {
        const result = await getAPI().eaa.search(query, 100)
        if (result.success && result.data?.events) {
          setSearchEvents(result.data.events.map(eventRecordToHistory))
        } else {
          setSearchEvents([])
        }
      } else {
        setSearchEvents(null)
      }
    } catch (err) {
      console.warn('[EventsTab] search/range error:', err)
      toast.error(t('toast.profile.queryEventFailed'))
      setSearchEvents([])
    }
    setSearchLoading(false)
  }

  // 搜索防抖（接入 Phase 1 useDebouncedCallback，替代手写 searchTimerRef + cleanup）
  // useDebouncedCallback 内部用 fnRef 持有最新闭包，调用时总是访问最新的
  // performSearch / dateStart / dateEnd / searchQuery，无需 useCallback 依赖管理
  const debouncedSearch = useDebouncedCallback((q: string, s: string, e: string) => {
    void performSearch(q, s, e)
  }, 300)

  const handleSearchChange = (value: string) => {
    onSearchQueryChange(value)
    // 清空搜索词时恢复 history 事件
    if (!value.trim() && !dateStart && !dateEnd) {
      setSearchEvents(null)
      return
    }
    // 防抖 300ms
    debouncedSearch(value, dateStart, dateEnd)
  }

  const handleDateChange = (start: string, end: string) => {
    onDateStartChange(start)
    onDateEndChange(end)
    // 无日期范围且无搜索词时恢复 history 事件
    if (!start && !end && !searchQuery.trim()) {
      setSearchEvents(null)
      return
    }
    // 防抖 300ms
    debouncedSearch(searchQuery, start, end)
  }

  const handleRevert = (eventId: string) => {
    revertDialog.open(eventId)
  }

  const executeRevert = async () => {
    const eventId = revertDialog.state.payload
    revertDialog.close()
    try {
      const result = await getAPI().eaa.revertEvent(eventId ?? '', `由 ${studentName} 档案页撤销`)
      if (result.success) {
        toast.success(t('toast.profile.eventReverted'))
        onRefresh()
      } else {
        toast.error(getErrorMessage(result, '撤销失败'))
      }
    } catch (err) {
      console.warn('[EventsTab] revert error:', err)
      toast.error(t('toast.profile.revertFailed'))
    }
  }

  const filterBtn = (val: string, label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      key={val}
      onClick={onClick}
      className={
        'px-3 py-1 rounded-lg text-xs transition-colors ' +
        (active
          ? 'bg-blue-600 text-white shadow-sm'
          : 'bg-gray-100 dark:bg-surface-elevated text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.08]')
      }
    >
      {label}
    </button>
  )

  // 搜索/范围模式指示
  const isSearchMode = searchEvents !== null

  return (
    <div className="space-y-3">
      {/* 搜索框 + 日期范围选择器 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="搜索事件..."
          className="flex-1 min-w-[140px] bg-gray-50 dark:bg-surface-primary border border-gray-300 dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <input
          type="date"
          value={dateStart}
          onChange={(e) => handleDateChange(e.target.value, dateEnd)}
          className="bg-gray-50 dark:bg-surface-primary border border-gray-300 dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 text-gray-700 dark:text-gray-300"
        />
        <span className="text-xs text-gray-400 dark:text-gray-500">至</span>
        <input
          type="date"
          value={dateEnd}
          onChange={(e) => handleDateChange(dateStart, e.target.value)}
          className="bg-gray-50 dark:bg-surface-primary border border-gray-300 dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 text-gray-700 dark:text-gray-300"
        />
        {isSearchMode && (
          <button
            type="button"
            onClick={() => {
              onSearchQueryChange('')
              onDateStartChange('')
              onDateEndChange('')
              setSearchEvents(null)
            }}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="清除搜索/筛选"
          >
            ✕ 重置
          </button>
        )}
        {searchLoading && <span className="text-xs text-blue-500 animate-pulse">查询中...</span>}
      </div>

      {/* 类型 + 时间筛选栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">类型:</span>
        {filterBtn('all', '全部', eventFilter === 'all', () => onFilterChange('all'))}
        {filterBtn('bonus', '加分', eventFilter === 'bonus', () => onFilterChange('bonus'))}
        {filterBtn('deduct', '扣分', eventFilter === 'deduct', () => onFilterChange('deduct'))}
        <span className="text-xs text-gray-300 dark:text-gray-600 mx-1">|</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">时间:</span>
        {filterBtn('all', '全部', timeRange === 'all', () => onTimeRangeChange('all'))}
        {filterBtn('week', '本周', timeRange === 'week', () => onTimeRangeChange('week'))}
        {filterBtn('month', '本月', timeRange === 'month', () => onTimeRangeChange('month'))}
        {filterBtn('semester', '本学期', timeRange === 'semester', () =>
          onTimeRangeChange('semester'),
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
          {isSearchMode ? `搜索结果 ${displayEvents.length} 条` : `共 ${displayEvents.length} 条`}
        </span>
      </div>

      {displayEvents.length === 0 ? (
        searchLoading ? (
          <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">
            查询中...
          </div>
        ) : (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title={isSearchMode ? '未找到匹配的事件' : '暂无事件记录'}
            className="py-12"
          />
        )
      ) : (
        <div className="space-y-2">
          {displayEvents.map((evt) => (
            <EventCard
              key={evt.event_id}
              event={evt}
              expanded={expandedEvent === evt.event_id}
              onToggle={() =>
                setExpandedEvent(expandedEvent === evt.event_id ? null : evt.event_id)
              }
              reasonLabel={reasonCodes.find((c) => c.code === evt.reason_code)?.label}
              onRevert={!evt.reverted ? () => handleRevert(evt.event_id) : undefined}
            />
          ))}
        </div>
      )}

      {/* 撤销事件确认对话框 */}
      <ConfirmDialog
        open={revertDialog.state.open}
        title="撤销事件"
        message="确定要撤销此事件吗？撤销后分数将回退。"
        confirmText="撤销"
        variant="danger"
        onConfirm={executeRevert}
        onCancel={revertDialog.close}
      />
    </div>
  )
}
