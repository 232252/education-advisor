// =============================================================
// useDashboardFilters — Dashboard 班级筛选与派生统计
// 职责：持有班级筛选 / 对比模式局部状态，并从原始数据派生
// 排行、学生统计、分数分布、事件聚合等视图数据。
// 纯计算均委托 dashboard-stats.ts（便于单测覆盖边界）。
// =============================================================

import type { ClassEntity, EAAEventRecord, EAARankItem, EAAStudent } from '@shared/types'
import { useMemo, useState } from 'react'
import {
  CLASS_FILTER_ALL,
  computeClassComparison,
  computeClassStats,
  computePeriodSummary,
  computeReasonDistribution,
  computeScoreIntervals,
  matchesClassFilter,
  SCORE_ORDER,
} from '../dashboard-stats'

export function useDashboardFilters({
  classList,
  allStudents,
  ranking,
  allEvents,
}: {
  classList: ClassEntity[]
  allStudents: EAAStudent[]
  ranking: EAARankItem[]
  allEvents: EAAEventRecord[]
}) {
  // 班级筛选 & 对比模式（仅本页使用的局部状态）
  const [classFilter, setClassFilter] = useState<string>(CLASS_FILTER_ALL)
  const [compareMode, setCompareMode] = useState(false)
  const [compareClassA, setCompareClassA] = useState<string>('')
  const [compareClassB, setCompareClassB] = useState<string>('')

  // 活跃班级列表
  const activeClassList = useMemo(() => classList.filter((c) => !c.archived), [classList])

  // entity_id → class_id 映射 (用于过滤排行/事件)
  const entityIdToClassId = useMemo(() => {
    const m: Record<string, string | null> = {}
    for (const s of allStudents) m[s.entity_id] = s.class_id
    return m
  }, [allStudents])

  // 按班级过滤后的学生集合 (复用过滤逻辑,供统计/分数分布使用)
  const filteredStudents = useMemo(
    () =>
      classFilter === CLASS_FILTER_ALL
        ? allStudents
        : allStudents.filter((s) => matchesClassFilter(s.class_id, classFilter)),
    [allStudents, classFilter],
  )

  // 按班级过滤后的学生统计（逻辑提取到 dashboard-stats.ts）
  const classStats = useMemo(() => computeClassStats(filteredStudents), [filteredStudents])

  // 按班级过滤后的排行 (取前10)
  const filteredRanking = useMemo(() => {
    if (classFilter === CLASS_FILTER_ALL) return ranking
    return ranking.filter((r) => matchesClassFilter(entityIdToClassId[r.entity_id], classFilter))
  }, [ranking, classFilter, entityIdToClassId])

  // 按班级过滤后的分数分布（逻辑提取到 dashboard-stats.ts）
  const scoreIntervals = useMemo(() => computeScoreIntervals(filteredStudents), [filteredStudents])

  // 按班级过滤后的事件集合 (基于 entityIdToClassId 映射)
  const filteredEvents = useMemo(() => {
    if (classFilter === CLASS_FILTER_ALL) return allEvents
    return allEvents.filter((e) => matchesClassFilter(entityIdToClassId[e.entity_id], classFilter))
  }, [allEvents, classFilter, entityIdToClassId])

  // entity_id → name 映射 (用于周期摘要 top_gainers/losers 显示学生名)
  const entityIdToName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of allStudents) m[s.entity_id] = s.name
    return m
  }, [allStudents])

  // 按班级过滤后的事件原因分布（逻辑提取到 dashboard-stats.ts）
  const classReasonDist = useMemo(() => computeReasonDistribution(filteredEvents), [filteredEvents])

  // 按班级过滤后的周期摘要 (事件计数 + top_gainers/losers，逻辑提取到 dashboard-stats.ts)
  const classPeriodSummary = useMemo(
    () => computePeriodSummary(filteredEvents, entityIdToName),
    [filteredEvents, entityIdToName],
  )

  // 班级对比数据: 每个班级的学生数/平均分/高风险数（逻辑提取到 dashboard-stats.ts）
  const classComparison = useMemo(
    () =>
      computeClassComparison(activeClassList, allStudents).map((c) => {
        const cls = activeClassList.find((x) => x.class_id === c.classId)
        return {
          ...c,
          grade: cls?.grade ?? '-',
          teacher: cls?.teacher ?? '-',
        }
      }),
    [activeClassList, allStudents],
  )

  // 双班级对比数据
  const compareDataA = useMemo(() => {
    if (!compareClassA) return null
    return classComparison.find((c) => c.classId === compareClassA) ?? null
  }, [classComparison, compareClassA])
  const compareDataB = useMemo(() => {
    if (!compareClassB) return null
    return classComparison.find((c) => c.classId === compareClassB) ?? null
  }, [classComparison, compareClassB])

  // 按风险等级排序：极高 → 高 → 中 → 低 (SCORE_ORDER 常量在 dashboard-stats.ts)
  const sortedScoreKeys = useMemo(
    () => SCORE_ORDER.filter((k) => k in scoreIntervals),
    [scoreIntervals],
  )

  return {
    // 筛选/对比状态
    classFilter,
    setClassFilter,
    compareMode,
    setCompareMode,
    compareClassA,
    setCompareClassA,
    compareClassB,
    setCompareClassB,
    // 派生视图数据
    activeClassList,
    filteredRanking,
    classStats,
    scoreIntervals,
    sortedScoreKeys,
    classReasonDist,
    classPeriodSummary,
    classComparison,
    compareDataA,
    compareDataB,
  }
}
