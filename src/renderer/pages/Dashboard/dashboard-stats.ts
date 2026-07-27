// =============================================================
// 仪表盘统计计算工具 — 从 DashboardPage 提取的纯函数
//
// 提取原因：分数分桶、事件聚合、top-N 排序等逻辑在 useMemo 闭包里，
// 边界（分数 59.9/60/100、空事件、并列 delta）难以通过组件测试覆盖。
// =============================================================

import type { EAAEventRecord, EAAStudent } from '@shared/types'

/** 分数分桶区间标签 */
export const SCORE_INTERVAL_LABELS = {
  VERY_HIGH: '极高(<60)',
  HIGH: '高(60-80)',
  MID: '中(80-100)',
  LOW: '低(>=100)',
} as const

/**
 * 计算学生分数分布（4 桶）。
 * 区间：[0,60) / [60,80) / [80,100) / [100,+∞)
 */
export function computeScoreIntervals(students: EAAStudent[]): Record<string, number> {
  const buckets: Record<string, number> = {
    [SCORE_INTERVAL_LABELS.VERY_HIGH]: 0,
    [SCORE_INTERVAL_LABELS.HIGH]: 0,
    [SCORE_INTERVAL_LABELS.MID]: 0,
    [SCORE_INTERVAL_LABELS.LOW]: 0,
  }
  for (const s of students) {
    if (s.score < 60) buckets[SCORE_INTERVAL_LABELS.VERY_HIGH]++
    else if (s.score < 80) buckets[SCORE_INTERVAL_LABELS.HIGH]++
    else if (s.score < 100) buckets[SCORE_INTERVAL_LABELS.MID]++
    else buckets[SCORE_INTERVAL_LABELS.LOW]++
  }
  return buckets
}

/** 事件原因码分布（按出现次数降序） */
export function computeReasonDistribution(
  events: EAAEventRecord[],
): Array<{ code: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const e of events) {
    const code = e.reason_code || 'UNKNOWN'
    counts[code] = (counts[code] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
}

/** 周期摘要计算结果 */
export interface PeriodSummary {
  events: {
    total: number
    bonus_count: number
    deduct_count: number
    bonus_total: number
    deduct_total: number
  }
  top_gainers: Array<{ name: string; delta: number }>
  top_losers: Array<{ name: string; delta: number }>
}

/**
 * 计算事件周期摘要：加分/扣分统计 + top 3 涨跌学生。
 *
 * @param events 事件列表
 * @param entityIdToName entity_id → 学生名映射
 * @param topN 涨跌幅前 N 名（默认 3）
 */
export function computePeriodSummary(
  events: EAAEventRecord[],
  entityIdToName: Record<string, string>,
  topN = 3,
): PeriodSummary {
  let bonusCount = 0
  let deductCount = 0
  let bonusTotal = 0
  let deductTotal = 0
  const deltaByEntity: Record<string, number> = {}
  for (const e of events) {
    const d = e.score_delta
    if (d > 0) {
      bonusCount++
      bonusTotal += d
    } else if (d < 0) {
      deductCount++
      deductTotal += d
    }
    deltaByEntity[e.entity_id] = (deltaByEntity[e.entity_id] ?? 0) + d
  }
  const gainers = Object.entries(deltaByEntity)
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([eid, d]) => ({ name: entityIdToName[eid] ?? eid, delta: d }))
  const losers = Object.entries(deltaByEntity)
    .filter(([, d]) => d < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, topN)
    .map(([eid, d]) => ({ name: entityIdToName[eid] ?? eid, delta: d }))
  return {
    events: {
      total: events.length,
      bonus_count: bonusCount,
      deduct_count: deductCount,
      bonus_total: bonusTotal,
      deduct_total: deductTotal,
    },
    top_gainers: gainers,
    top_losers: losers,
  }
}

/** 单个班级的对比统计 */
export interface ClassComparisonItem {
  classId: string
  className: string
  studentCount: number
  avgScore: number
  highRisk: number
  riskDistribution: Record<string, number>
}

/**
 * 计算班级对比数据：每个班级的学生数/平均分/风险分布。
 *
 * @param classList 班级列表
 * @param allStudents 全部学生
 */
export function computeClassComparison(
  classList: Array<{ class_id: string; name: string; grade?: string; teacher?: string }>,
  allStudents: EAAStudent[],
): ClassComparisonItem[] {
  return classList.map((c) => {
    const students = allStudents.filter((s) => s.class_id === c.class_id)
    const riskCount: Record<string, number> = { 极高: 0, 高: 0, 中: 0, 低: 0 }
    let totalScore = 0
    for (const s of students) {
      riskCount[s.risk] = (riskCount[s.risk] ?? 0) + 1
      totalScore += s.score
    }
    return {
      classId: c.class_id,
      className: c.name,
      studentCount: students.length,
      avgScore: students.length > 0 ? totalScore / students.length : 0,
      highRisk: riskCount.极高 + riskCount.高,
      riskDistribution: riskCount,
    }
  })
}
