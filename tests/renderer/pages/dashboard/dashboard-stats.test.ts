// =============================================================
// dashboard-stats — 纯函数单元测试
// 覆盖: matchesClassFilter / computeClassStats / computeScoreIntervals /
//       computeReasonDistribution / computePeriodSummary / computeClassComparison
// 重点边界: 分数 59.9/60/79.9/80/99.9/100、空集合、null class_id、并列 delta
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAEventRecord, EAAStudent } from '@shared/types'
import {
  CLASS_FILTER_ALL,
  CLASS_FILTER_NONE,
  computeClassComparison,
  computeClassStats,
  computePeriodSummary,
  computeReasonDistribution,
  computeScoreIntervals,
  matchesClassFilter,
  SCORE_ORDER,
} from '../../../../src/renderer/pages/Dashboard/dashboard-stats'

// ---------- 测试数据工厂 ----------

function makeStudent(overrides: Partial<EAAStudent> = {}): EAAStudent {
  return {
    name: '学生',
    entity_id: 'e1',
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<EAAEventRecord> = {}): EAAEventRecord {
  return {
    event_id: 'ev1',
    name: '学生',
    entity_id: 'e1',
    timestamp: '2026-01-01T00:00:00Z',
    event_type: 'ConductBonus',
    reason_code: 'R1',
    original_reason: 'r',
    score_delta: 1,
    note: '',
    tags: [],
    operator: 'op',
    is_valid: true,
    reverted_by: null,
    ...overrides,
  }
}

// ---------- matchesClassFilter ----------

describe('matchesClassFilter', () => {
  it('CLASS_FILTER_ALL 哨兵: 任何 entityClassId 均命中', () => {
    expect(matchesClassFilter(null, CLASS_FILTER_ALL)).toBe(true)
    expect(matchesClassFilter(undefined, CLASS_FILTER_ALL)).toBe(true)
    expect(matchesClassFilter('G7-3', CLASS_FILTER_ALL)).toBe(true)
  })

  it('CLASS_FILTER_NONE 哨兵: 仅未分班(null/undefined)命中', () => {
    expect(matchesClassFilter(null, CLASS_FILTER_NONE)).toBe(true)
    expect(matchesClassFilter(undefined, CLASS_FILTER_NONE)).toBe(true)
    expect(matchesClassFilter('G7-3', CLASS_FILTER_NONE)).toBe(false)
  })

  it('具体 class_id: 精确相等命中', () => {
    expect(matchesClassFilter('G7-3', 'G7-3')).toBe(true)
    expect(matchesClassFilter('G7-4', 'G7-3')).toBe(false)
    expect(matchesClassFilter(null, 'G7-3')).toBe(false)
    expect(matchesClassFilter(undefined, 'G7-3')).toBe(false)
  })
})

// ---------- computeClassStats ----------

describe('computeClassStats', () => {
  it('空学生集合: total/avgScore/highRisk 全 0, 风险分布全 0', () => {
    const stats = computeClassStats([])
    expect(stats.total).toBe(0)
    expect(stats.avgScore).toBe(0)
    expect(stats.highRisk).toBe(0)
    expect(stats.riskDistribution).toEqual({ 极高: 0, 高: 0, 中: 0, 低: 0 })
  })

  it('平均分计算(除法结果保留浮点)', () => {
    const stats = computeClassStats([makeStudent({ score: 60 }), makeStudent({ score: 61 })])
    expect(stats.total).toBe(2)
    expect(stats.avgScore).toBeCloseTo(60.5, 10)
  })

  it('highRisk = 极高 + 高 的人数之和', () => {
    const stats = computeClassStats([
      makeStudent({ risk: '极高' }),
      makeStudent({ risk: '高' }),
      makeStudent({ risk: '高' }),
      makeStudent({ risk: '中' }),
      makeStudent({ risk: '低' }),
    ])
    expect(stats.highRisk).toBe(3)
    expect(stats.riskDistribution).toEqual({ 极高: 1, 高: 2, 中: 1, 低: 1 })
  })
})

// ---------- computeScoreIntervals ----------

describe('computeScoreIntervals', () => {
  it('空集合: 四桶全 0', () => {
    expect(computeScoreIntervals([])).toEqual({
      '极高(<60)': 0,
      '高(60-80)': 0,
      '中(80-100)': 0,
      '低(>=100)': 0,
    })
  })

  it('分桶边界: 59.9 → 极高, 60 → 高, 79.9 → 高, 80 → 中, 99.9 → 中, 100 → 低', () => {
    const buckets = computeScoreIntervals([
      makeStudent({ score: 0 }),
      makeStudent({ score: 59.9 }),
      makeStudent({ score: 60 }),
      makeStudent({ score: 79.9 }),
      makeStudent({ score: 80 }),
      makeStudent({ score: 99.9 }),
      makeStudent({ score: 100 }),
      makeStudent({ score: 200 }),
    ])
    expect(buckets).toEqual({
      '极高(<60)': 2,
      '高(60-80)': 2,
      '中(80-100)': 2,
      '低(>=100)': 2,
    })
  })

  it('SCORE_ORDER 顺序: 极高 → 高 → 中 → 低', () => {
    expect(SCORE_ORDER).toEqual(['极高(<60)', '高(60-80)', '中(80-100)', '低(>=100)'])
  })
})

// ---------- computeReasonDistribution ----------

describe('computeReasonDistribution', () => {
  it('空事件: 返回空数组', () => {
    expect(computeReasonDistribution([])).toEqual([])
  })

  it('按出现次数降序排序', () => {
    const dist = computeReasonDistribution([
      makeEvent({ reason_code: 'A' }),
      makeEvent({ reason_code: 'B' }),
      makeEvent({ reason_code: 'B' }),
      makeEvent({ reason_code: 'C' }),
      makeEvent({ reason_code: 'C' }),
      makeEvent({ reason_code: 'C' }),
    ])
    expect(dist).toEqual([
      { code: 'C', count: 3 },
      { code: 'B', count: 2 },
      { code: 'A', count: 1 },
    ])
  })

  it('空 reason_code 归入 UNKNOWN', () => {
    const dist = computeReasonDistribution([
      makeEvent({ reason_code: '' }),
      makeEvent({ reason_code: '' }),
    ])
    expect(dist).toEqual([{ code: 'UNKNOWN', count: 2 }])
  })
})

// ---------- computePeriodSummary ----------

describe('computePeriodSummary', () => {
  it('空事件: 计数全 0, top 榜为空', () => {
    const s = computePeriodSummary([], {})
    expect(s.events).toEqual({
      total: 0,
      bonus_count: 0,
      deduct_count: 0,
      bonus_total: 0,
      deduct_total: 0,
    })
    expect(s.top_gainers).toEqual([])
    expect(s.top_losers).toEqual([])
  })

  it('加分/扣分计数与累计, delta=0 的事件只计入 total', () => {
    const s = computePeriodSummary(
      [
        makeEvent({ score_delta: 5 }),
        makeEvent({ score_delta: 3 }),
        makeEvent({ score_delta: -2 }),
        makeEvent({ score_delta: 0 }),
      ],
      {},
    )
    expect(s.events.total).toBe(4)
    expect(s.events.bonus_count).toBe(2)
    expect(s.events.bonus_total).toBe(8)
    expect(s.events.deduct_count).toBe(1)
    expect(s.events.deduct_total).toBe(-2)
  })

  it('top_gainers 降序 / top_losers 升序, 默认 topN=3', () => {
    const events = [
      makeEvent({ entity_id: 'e1', score_delta: 10 }),
      makeEvent({ entity_id: 'e2', score_delta: 30 }),
      makeEvent({ entity_id: 'e3', score_delta: 20 }),
      makeEvent({ entity_id: 'e4', score_delta: 40 }),
      makeEvent({ entity_id: 'e5', score_delta: -5 }),
      makeEvent({ entity_id: 'e6', score_delta: -30 }),
      makeEvent({ entity_id: 'e7', score_delta: -15 }),
      makeEvent({ entity_id: 'e8', score_delta: -40 }),
    ]
    const s = computePeriodSummary(events, {
      e1: '甲',
      e2: '乙',
      e3: '丙',
      e4: '丁',
      e5: '戊',
      e6: '己',
      e7: '庚',
      e8: '辛',
    })
    expect(s.top_gainers.map((g) => g.name)).toEqual(['丁', '乙', '丙'])
    expect(s.top_gainers.map((g) => g.delta)).toEqual([40, 30, 20])
    expect(s.top_losers.map((l) => l.name)).toEqual(['辛', '己', '庚'])
    expect(s.top_losers.map((l) => l.delta)).toEqual([-40, -30, -15])
  })

  it('topN 参数可自定义, 事件按 entity_id 累计 delta', () => {
    const events = [
      makeEvent({ entity_id: 'e1', score_delta: 5 }),
      makeEvent({ entity_id: 'e1', score_delta: 5 }),
      makeEvent({ entity_id: 'e2', score_delta: 3 }),
    ]
    const s = computePeriodSummary(events, {}, 1)
    // e1 累计 +10, 排在 e2(+3) 之前, topN=1 只取第一名
    expect(s.top_gainers).toEqual([{ name: 'e1', delta: 10 }])
  })

  it('entityIdToName 缺失时回退显示 entity_id', () => {
    const s = computePeriodSummary([makeEvent({ entity_id: 'eX', score_delta: 1 })], {
      other: '别人',
    })
    expect(s.top_gainers[0].name).toBe('eX')
  })

  it('同一实体加扣抵消后净值为 0 时, 不出现在任一 top 榜', () => {
    const s = computePeriodSummary(
      [makeEvent({ entity_id: 'e1', score_delta: 5 }), makeEvent({ entity_id: 'e1', score_delta: -5 })],
      {},
    )
    expect(s.top_gainers).toEqual([])
    expect(s.top_losers).toEqual([])
  })
})

// ---------- computeClassComparison ----------

describe('computeClassComparison', () => {
  it('空班级列表: 返回空数组', () => {
    expect(computeClassComparison([], [])).toEqual([])
  })

  it('无学生的班级: studentCount/avgScore/highRisk 为 0', () => {
    const items = computeClassComparison([{ class_id: 'G7-1', name: '七年级1班' }], [
      makeStudent({ class_id: 'G7-2' }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].studentCount).toBe(0)
    expect(items[0].avgScore).toBe(0)
    expect(items[0].highRisk).toBe(0)
  })

  it('按 class_id 归班统计: 学生数/平均分/高风险数/风险分布', () => {
    const allStudents = [
      makeStudent({ class_id: 'G7-1', score: 60, risk: '极高' }),
      makeStudent({ class_id: 'G7-1', score: 80, risk: '中' }),
      makeStudent({ class_id: 'G7-2', score: 100, risk: '低' }),
      makeStudent({ class_id: null }),
    ]
    const items = computeClassComparison(
      [
        { class_id: 'G7-1', name: '七年级1班', grade: '七年级', teacher: '张老师' },
        { class_id: 'G7-2', name: '七年级2班' },
      ],
      allStudents,
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      classId: 'G7-1',
      className: '七年级1班',
      studentCount: 2,
      avgScore: 70,
      highRisk: 1,
    })
    expect(items[0].riskDistribution).toEqual({ 极高: 1, 高: 0, 中: 1, 低: 0 })
    expect(items[1]).toMatchObject({
      classId: 'G7-2',
      studentCount: 1,
      avgScore: 100,
      highRisk: 0,
    })
  })
})