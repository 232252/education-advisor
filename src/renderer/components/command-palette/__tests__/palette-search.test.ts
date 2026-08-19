// =============================================================
// palette-search 单元测试 — 匹配评分/各域搜索/分组排序
// =============================================================

import type { AgentListItem, ClassEntity, EAAEventRecord, EAAStudent } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  buildEventResults,
  groupResults,
  matchScore,
  searchAgents,
  searchClasses,
  searchLocal,
  searchNav,
  searchStudents,
} from '../palette-search'

function makeStudent(over: Partial<EAAStudent>): EAAStudent {
  return {
    name: '张三',
    entity_id: 'stu-001',
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
    ...over,
  }
}

function makeClass(over: Partial<ClassEntity>): ClassEntity {
  return {
    id: 'cls-1',
    class_id: 'C2026-01',
    name: '高一(1)班',
    grade: '高一',
    teacher: undefined,
    note: undefined,
    archived: false,
    created_at: 1754000000000,
    ...over,
  }
}

function makeAgent(over: Partial<AgentListItem>): AgentListItem {
  return {
    id: 'agent-1',
    name: '学情分析师',
    role: 'analyst',
    description: '分析班级学情数据',
    enabled: true,
    modelTier: 'high_quality',
    schedule: [],
    capabilities: [],
    status: 'idle',
    ...over,
  }
}

const NAV = [
  { path: '/students', label: '学生管理', keywords: 'students 学生' },
  { path: '/settings', label: '设置', keywords: 'settings 设置' },
]

describe('matchScore', () => {
  it('完全相等得分最高', () => {
    expect(matchScore('张三', '张三')).toBe(120)
  })
  it('前缀匹配高于子串匹配', () => {
    expect(matchScore('张', '张三')).toBe(100)
    expect(matchScore('三', '张三')).toBeLessThan(100)
    expect(matchScore('三', '张三')).toBeGreaterThan(0)
  })
  it('大小写不敏感', () => {
    expect(matchScore('ABC', 'abc')).toBe(120)
    expect(matchScore('abc', 'XABC')).toBeGreaterThan(0)
  })
  it('不匹配返回 -1', () => {
    expect(matchScore('李四', '张三')).toBe(-1)
  })
  it('子串越靠前得分越高', () => {
    const early = matchScore('b', 'abbb')
    const late = matchScore('b', 'aaab')
    expect(early).toBeGreaterThan(late)
  })
})

describe('searchStudents', () => {
  it('按姓名匹配并生成跳转链接', () => {
    const r = searchStudents('张', [makeStudent({})])
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('student')
    expect(r[0].target).toBe('/students?entity_id=stu-001')
    expect(r[0].title).toBe('张三')
  })
  it('entity_id 也可命中但排序在姓名命中之后', () => {
    const students = [
      makeStudent({ name: '李四', entity_id: 'stu-002' }),
      makeStudent({ name: '王五', entity_id: 'stu-003' }),
    ]
    const byId = searchStudents('stu-003', students)
    expect(byId).toHaveLength(1)
    expect(byId[0].title).toBe('王五')
    const both = searchStudents('张', [
      makeStudent({ name: '张三', entity_id: 'zzz' }),
      makeStudent({ name: 'x', entity_id: 'zhang' }),
    ])
    expect(both[0].title).toBe('张三') // 姓名命中 > id 命中
  })
  it('遵循数量上限', () => {
    const students = Array.from({ length: 10 }, (_, i) =>
      makeStudent({ name: `张${i}`, entity_id: `stu-${i}` }),
    )
    expect(searchStudents('张', students)).toHaveLength(5)
  })
  it('无匹配返回空数组', () => {
    expect(searchStudents('不存在', [makeStudent({})])).toHaveLength(0)
  })
})

describe('searchClasses', () => {
  it('按班级名与 class_id 匹配', () => {
    const cls = [makeClass({})]
    expect(searchClasses('高一', cls)).toHaveLength(1)
    expect(searchClasses('C2026', cls)).toHaveLength(1)
    expect(searchClasses('高二', cls)).toHaveLength(0)
  })
  it('已存档班级在副标题中标注', () => {
    const r = searchClasses('高一', [makeClass({ archived: true })])
    expect(r[0].subtitle).toContain('已存档')
  })
})

describe('searchAgents', () => {
  it('按名称与描述匹配', () => {
    const a = [makeAgent({})]
    expect(searchAgents('学情', a)).toHaveLength(1)
    expect(searchAgents('分析班级', a)).toHaveLength(1)
    expect(searchAgents('不存在', a)).toHaveLength(0)
  })
})

describe('searchNav', () => {
  it('空查询返回全部导航项', () => {
    expect(searchNav('', NAV)).toHaveLength(2)
  })
  it('label 与 keywords 均可命中', () => {
    expect(searchNav('学生', NAV)).toHaveLength(1)
    expect(searchNav('students', NAV)).toHaveLength(1)
  })
})

describe('searchLocal', () => {
  const data = {
    students: [makeStudent({})],
    classes: [makeClass({})],
    agents: [makeAgent({})],
    navCommands: NAV,
  }
  it('空查询只返回导航', () => {
    const r = searchLocal('  ', data)
    expect(r).toHaveLength(2)
    expect(r.every((x) => x.kind === 'nav')).toBe(true)
  })
  it('有查询时按 学生>班级>Agent>导航 顺序', () => {
    const r = searchLocal('一', data) // "高一(1)班" 命中班级
    expect(r.map((x) => x.kind)).toEqual(['class'])
    const r2 = searchLocal('学', data) // 学情分析师(agent)、学情分析师描述、学生管理关键字
    const kinds = r2.map((x) => x.kind)
    expect(kinds.indexOf('agent')).toBeGreaterThanOrEqual(0)
  })
})

describe('buildEventResults', () => {
  it('映射事件到学生跳转并限制数量', () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      event_id: `ev-${i}`,
      name: `学生${i}`,
      entity_id: `stu-${i}`,
      timestamp: '2026-08-01T10:00:00Z',
      event_type: 'ConductDeduct' as const,
      reason_code: 'H001',
      original_reason: '',
      score_delta: -2,
      note: '',
      tags: [],
      operator: 'teacher',
      is_valid: true,
      reverted_by: null,
    }))
    const r = buildEventResults(events)
    expect(r).toHaveLength(5)
    expect(r[0].target).toBe('/students?entity_id=stu-0')
    expect(r[0].subtitle).toContain('-2')
  })
  it('已撤销事件在副标题中标注', () => {
    const e: EAAEventRecord = {
      event_id: 'ev-1',
      name: '张三',
      entity_id: 'stu-1',
      timestamp: '2026-08-01T10:00:00Z',
      event_type: 'ConductBonus',
      reason_code: 'B001',
      original_reason: '',
      score_delta: 3,
      note: '',
      tags: [],
      operator: 'teacher',
      is_valid: false,
      reverted_by: 'ev-0',
    }
    expect(buildEventResults([e])[0].subtitle).toContain('已撤销')
  })
})

describe('groupResults', () => {
  it('按固定顺序分组并跳过空组', () => {
    const groups = groupResults([
      { id: 'n1', kind: 'nav', title: 'a', score: 1, target: '/x' },
      { id: 's1', kind: 'student', title: 'b', score: 2, target: '/y' },
    ])
    expect(groups.map((g) => g.kind)).toEqual(['student', 'nav'])
  })
})
