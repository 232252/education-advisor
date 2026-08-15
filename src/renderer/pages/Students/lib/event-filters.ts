// =============================================================
// 学生事件过滤工具 — 从 StudentProfile filteredEvents useMemo 提取的纯函数
// =============================================================

import type { EAAHistoryEvent } from '@shared/types'

/** 事件分数筛选类型 */
export type EventScoreFilter = 'all' | 'bonus' | 'deduct'

/** 事件时间范围筛选类型 */
export type EventTimeRange = 'all' | 'week' | 'month' | 'semester'

/** 时间范围 → 毫秒数 */
const EVENT_TIME_RANGE_MS: Record<string, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  semester: 120 * 24 * 60 * 60 * 1000,
}

/**
 * 按分数方向（加分/扣分）与时间范围过滤事件列表。
 *
 * @param events 全部事件
 * @param filter 分数筛选（all=全部 / bonus=加分 / deduct=扣分）
 * @param timeRange 时间范围（all=全部 / week=近一周 / month=近一月 / semester=近一学期）
 */
export function filterEvents(
  events: EAAHistoryEvent[],
  filter: EventScoreFilter,
  timeRange: EventTimeRange,
): EAAHistoryEvent[] {
  let result = events
  if (filter === 'bonus') result = result.filter((e) => e.score_delta > 0)
  if (filter === 'deduct') result = result.filter((e) => e.score_delta < 0)
  if (timeRange !== 'all') {
    // now 在调用方 useMemo 内计算，避免每次渲染都使 memo 失效
    const cutoff = Date.now() - EVENT_TIME_RANGE_MS[timeRange]
    result = result.filter((e) => new Date(e.timestamp).getTime() > cutoff)
  }
  return result
}
