// =============================================================
// useDashboardFilters — 班级筛选与派生统计 hook 测试
// 覆盖: 初始状态 / 班级筛选(具体班+未分班) / 存档班过滤 /
//       对比模式与双班数据 / classComparison 默认值 / 周期摘要联动
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ClassEntity, EAAEventRecord, EAARankItem, EAAStudent } from '@shared/types'
import {
  CLASS_FILTER_ALL,
  CLASS_FILTER_NONE,
} from '../../../../src/renderer/pages/Dashboard/dashboard-stats'
import { useDashboardFilters } from '../../../../src/renderer/pages/Dashboard/hooks/useDashboardFilters'

// ---------- 测试数据 ----------

function makeStudent(overrides: Partial<EAAStudent>): EAAStudent {
  return {
    name: '学生',
    entity_id: 'e0',
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

const s1 = makeStudent({ name: '甲', entity_id: 'e1', class_id: 'G7-1', score: 55, risk: '极高' })
const s2 = makeStudent({ name: '乙', entity_id: 'e2', class_id: 'G7-1', score: 75, risk: '高' })
const s3 = makeStudent({ name: '丙', entity_id: 'e3', class_id: 'G7-2', score: 95, risk: '中' })
const s4 = makeStudent({ name: '丁', entity_id: 'e4', class_id: null, score: 120, risk: '低' })
const allStudents = [s1, s2, s3, s4]

const classList: ClassEntity[] = [
  {
    id: '1',
    class_id: 'G7-1',
    name: '七年级1班',
    grade: '七年级',
    teacher: '张老师',
    archived: false,
    created_at: 0,
  },
  { id: '2', class_id: 'G7-2', name: '七年级2班', archived: false, created_at: 0 },
  { id: '3', class_id: 'G8-1', name: '八年级1班', archived: true, created_at: 0 },
]

const ranking: EAARankItem[] = [
  { rank: 1, name: '丁', entity_id: 'e4', score: 120, delta: 0, risk: '低' },
  { rank: 2, name: '丙', entity_id: 'e3', score: 95, delta: 0, risk: '中' },
  { rank: 3, name: '乙', entity_id: 'e2', score: 75, delta: 0, risk: '高' },
  { rank: 4, name: '甲', entity_id: 'e1', score: 55, delta: 0, risk: '极高' },
]

function makeEvent(entityId: string, delta: number, code: string): EAAEventRecord {
  return {
    event_id: `ev-${entityId}`,
    name: 'n',
    entity_id: entityId,
    timestamp: '2026-01-01T00:00:00Z',
    event_type: delta >= 0 ? 'ConductBonus' : 'ConductDeduct',
    reason_code: code,
    original_reason: 'r',
    score_delta: delta,
    note: '',
    tags: [],
    operator: 'op',
    is_valid: true,
    reverted_by: null,
  }
}

const allEvents = [
  makeEvent('e1', 5, 'A'),
  makeEvent('e2', -3, 'B'),
  makeEvent('e3', 10, 'A'),
  makeEvent('e4', 2, ''),
]

function setup() {
  return renderHook(() => useDashboardFilters({ classList, allStudents, ranking, allEvents }))
}

// ---------- 测试 ----------

describe('useDashboardFilters — 初始状态', () => {
  it('默认值: classFilter=ALL / compareMode=false / compareClass 空', () => {
    const { result } = setup()
    expect(result.current.classFilter).toBe(CLASS_FILTER_ALL)
    expect(result.current.compareMode).toBe(false)
    expect(result.current.compareClassA).toBe('')
    expect(result.current.compareClassB).toBe('')
  })

  it('activeClassList 过滤掉已存档班级', () => {
    const { result } = setup()
    expect(result.current.activeClassList.map((c) => c.class_id)).toEqual(['G7-1', 'G7-2'])
  })

  it('ALL 模式: 统计/排行/事件不过滤', () => {
    const { result } = setup()
    expect(result.current.classStats.total).toBe(4)
    expect(result.current.filteredRanking).toHaveLength(4)
    expect(result.current.classPeriodSummary.events.total).toBe(4)
  })

  it('sortedScoreKeys 按 SCORE_ORDER 输出四个桶', () => {
    const { result } = setup()
    expect(result.current.sortedScoreKeys).toEqual([
      '极高(<60)',
      '高(60-80)',
      '中(80-100)',
      '低(>=100)',
    ])
  })

  it('compareDataA/B 默认为 null(未选择对比班级)', () => {
    const { result } = setup()
    expect(result.current.compareDataA).toBeNull()
    expect(result.current.compareDataB).toBeNull()
  })
})

describe('useDashboardFilters — 班级筛选', () => {
  it('筛选具体班级: 学生统计/排行/分数分布只含该班', () => {
    const { result } = setup()
    act(() => {
      result.current.setClassFilter('G7-1')
    })
    expect(result.current.classStats.total).toBe(2)
    expect(result.current.classStats.highRisk).toBe(2)
    expect(result.current.filteredRanking.map((r) => r.entity_id).sort()).toEqual(['e1', 'e2'])
    // G7-1: 55(极高桶) + 75(高桶)
    expect(result.current.scoreIntervals['极高(<60)']).toBe(1)
    expect(result.current.scoreIntervals['高(60-80)']).toBe(1)
    expect(result.current.scoreIntervals['中(80-100)']).toBe(0)
  })

  it('筛选未分班(NONE): 只含 class_id 为空的学生', () => {
    const { result } = setup()
    act(() => {
      result.current.setClassFilter(CLASS_FILTER_NONE)
    })
    expect(result.current.classStats.total).toBe(1)
    expect(result.current.filteredRanking.map((r) => r.entity_id)).toEqual(['e4'])
  })

  it('事件聚合随班级筛选联动: 原因分布与周期摘要', () => {
    const { result } = setup()
    act(() => {
      result.current.setClassFilter('G7-1')
    })
    // G7-1 的事件: e1(+5, A) 与 e2(-3, B)
    expect(result.current.classPeriodSummary.events).toEqual({
      total: 2,
      bonus_count: 1,
      deduct_count: 1,
      bonus_total: 5,
      deduct_total: -3,
    })
    const codes = result.current.classReasonDist.map((d) => d.code)
    expect(codes).toContain('A')
    expect(codes).toContain('B')
    expect(codes).not.toContain('UNKNOWN')
  })

  it('切换回 ALL 后恢复全量数据', () => {
    const { result } = setup()
    act(() => {
      result.current.setClassFilter('G7-2')
    })
    expect(result.current.classStats.total).toBe(1)
    act(() => {
      result.current.setClassFilter(CLASS_FILTER_ALL)
    })
    expect(result.current.classStats.total).toBe(4)
  })
})

describe('useDashboardFilters — 对比模式', () => {
  it('setCompareMode 可切换对比状态', () => {
    const { result } = setup()
    act(() => {
      result.current.setCompareMode(true)
    })
    expect(result.current.compareMode).toBe(true)
  })

  it('compareDataA 命中班级并携带 grade/teacher', () => {
    const { result } = setup()
    act(() => {
      result.current.setCompareClassA('G7-1')
    })
    expect(result.current.compareDataA).toMatchObject({
      classId: 'G7-1',
      className: '七年级1班',
      grade: '七年级',
      teacher: '张老师',
      studentCount: 2,
    })
  })

  it('compareDataB 未知班级 id 返回 null', () => {
    const { result } = setup()
    act(() => {
      result.current.setCompareClassB('G-NotExist')
    })
    expect(result.current.compareDataB).toBeNull()
  })
})

describe('useDashboardFilters — classComparison', () => {
  it('只对比活跃班级, 缺失 grade/teacher 时以 "-" 占位', () => {
    const { result } = setup()
    expect(result.current.classComparison).toHaveLength(2)
    const g72 = result.current.classComparison.find((c) => c.classId === 'G7-2')
    expect(g72).toBeDefined()
    expect(g72?.grade).toBe('-')
    expect(g72?.teacher).toBe('-')
    expect(g72?.studentCount).toBe(1)
    expect(g72?.avgScore).toBe(95)
  })
})