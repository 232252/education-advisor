// =============================================================
// student-filters — 学生列表过滤测试(含 R167 拼音层)
// =============================================================

import type { EAAStudent } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { filterStudents, isAllSelected, sortStudentsByRisk } from '../student-filters'

const student = (name: string, class_id = '', risk: EAAStudent['risk'] = '中') =>
  ({
    entity_id: name,
    name,
    class_id,
    status: 'Active',
    score: 90,
    risk,
    groups: [],
    roles: [],
  }) as unknown as EAAStudent

const ARCHIVED = new Set(['G9-OLD'])
const noArchive = { archivedClassIds: ARCHIVED, showArchivedClass: false }
const ALL = '__ALL__'

describe('filterStudents — 拼音匹配(R167)', () => {
  it('首字母查询命中: "zs" → 张三', () => {
    const out = filterStudents([student('张三'), student('李四')], ALL, 'zs', ARCHIVED, false)
    expect(out.map((s) => s.name)).toEqual(['张三'])
  })
  it('全拼前缀命中: "zhangsan" → 张三', () => {
    const out = filterStudents([student('张三')], ALL, 'zhangsan', ARCHIVED, false)
    expect(out).toHaveLength(1)
  })
  it('查询含汉字时走原路径(拼音层不参与)', () => {
    const out = filterStudents([student('张三')], ALL, '张四', ARCHIVED, false)
    expect(out).toHaveLength(0)
  })
  it('拼音命中与班级过滤可叠加', () => {
    const out = filterStudents(
      [student('张三', 'G7-1'), student('张三丰', 'G9-OLD')],
      ALL,
      'zs',
      ARCHIVED,
      false,
    )
    // 已存档班级的张三丰被隐藏
    expect(out.map((s) => s.name)).toEqual(['张三'])
  })
})

describe('filterStudents — 原有行为', () => {
  it('中文子串原样命中', () => {
    const out = filterStudents([student('王小明')], ALL, '小明', ARCHIVED, false)
    expect(out).toHaveLength(1)
  })
  it('空搜索词全量通过', () => {
    const out = filterStudents([student('a'), student('b')], ALL, '', ARCHIVED, false)
    expect(out).toHaveLength(2)
  })
})

describe('sortStudentsByRisk / isAllSelected', () => {
  it('高风险优先排序', () => {
    const sorted = sortStudentsByRisk([student('低', '', '低'), student('极高', '', '极高')])
    expect(sorted[0].risk).toBe('极高')
  })
  it('全选判定', () => {
    const students = [student('a'), student('b')]
    expect(isAllSelected(students, new Set(['a', 'b']))).toBe(true)
    expect(isAllSelected(students, new Set(['a']))).toBe(false)
  })
})
