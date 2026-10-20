// =============================================================
// academics-shared + shared/academic-defaults 单元测试
// 覆盖: EXAM_TYPE_LABEL / EXAM_TYPE_BADGE / sortByDateDesc /
//       DEFAULT_SUBJECTS / DEFAULT_EXAM_TYPES
// 学期计算已移至 shared/academic-time,测试见 tests/shared/academic-time.test.ts
// =============================================================

import { describe, expect, it } from 'vitest'
import type { ExamType } from '@shared/types'
import {
  EXAM_TYPE_BADGE,
  EXAM_TYPE_LABEL,
  sortByDateDesc,
} from '../../../../src/renderer/lib/academics'
import {
  DEFAULT_EXAM_TYPES,
  DEFAULT_SUBJECTS,
} from '../../../../src/shared/academic-defaults'

// ---------- EXAM_TYPE_LABEL / EXAM_TYPE_BADGE ----------

describe('EXAM_TYPE_LABEL / EXAM_TYPE_BADGE', () => {
  const allTypes: ExamType[] = [
    'monthly',
    'midterm',
    'final',
    'test',
    'quiz',
    'mock',
    'other',
  ]

  it('每个考试类型都有非空中文标签', () => {
    for (const t of allTypes) {
      expect(EXAM_TYPE_LABEL[t].length).toBeGreaterThan(0)
    }
    expect(EXAM_TYPE_LABEL.midterm).toBe('期中')
    expect(EXAM_TYPE_LABEL.final).toBe('期末')
  })

  it('每个考试类型都有合法 Badge 颜色', () => {
    const valid = ['info', 'success', 'warning', 'danger', 'neutral']
    for (const t of allTypes) {
      expect(valid).toContain(EXAM_TYPE_BADGE[t])
    }
  })
})

// ---------- sortByDateDesc ----------

describe('sortByDateDesc', () => {
  it('按日期降序排序(最新在前)', () => {
    const input = [
      { id: 'e1', date: '2025-10-01' },
      { id: 'e3', date: '2025-12-01' },
      { id: 'e2', date: '2025-11-01' },
    ]
    expect(sortByDateDesc(input).map((x) => x.id)).toEqual(['e3', 'e2', 'e1'])
  })

  it('空数组返回空数组', () => {
    expect(sortByDateDesc([])).toEqual([])
  })

  it('不修改输入数组', () => {
    const input = [{ date: '2025-01-01' }, { date: '2025-12-01' }]
    sortByDateDesc(input)
    expect(input.map((x) => x.date)).toEqual(['2025-01-01', '2025-12-01'])
  })
})

// ---------- DEFAULT_SUBJECTS / DEFAULT_EXAM_TYPES ----------

describe('DEFAULT_SUBJECTS', () => {
  it('覆盖 10 个科目且 id 唯一', () => {
    expect(DEFAULT_SUBJECTS).toHaveLength(10)
    expect(new Set(DEFAULT_SUBJECTS.map((s) => s.id)).size).toBe(10)
  })

  it('每个科目字段完整且满分合法', () => {
    for (const s of DEFAULT_SUBJECTS) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.fullMark).toBeGreaterThan(0)
    }
  })

  it('语数英为主科且满分 150', () => {
    const core = DEFAULT_SUBJECTS.filter((s) => s.isCore)
    expect(core.map((s) => s.id)).toEqual(['chinese', 'math', 'english'])
    for (const s of core) expect(s.fullMark).toBe(150)
  })
})

describe('DEFAULT_EXAM_TYPES', () => {
  it('与 ExamType 一一对应', () => {
    const values = DEFAULT_EXAM_TYPES.map((t) => t.value).sort()
    expect(values).toEqual(
      ['final', 'midterm', 'mock', 'monthly', 'other', 'quiz', 'test'],
    )
  })

  it('每个类型都有非空中文标签', () => {
    for (const t of DEFAULT_EXAM_TYPES) {
      expect(t.label.length).toBeGreaterThan(0)
    }
  })
})
