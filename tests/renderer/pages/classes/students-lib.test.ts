// =============================================================
// Classes 纯逻辑测试 — lib/students.ts + class-id.ts
// 覆盖: 风险排序 / 名单过滤 / 日期格式化 / 编号自动生成
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAStudent } from '@shared/types'
import {
  filterAssignableStudents,
  filterClassStudents,
  formatDate,
} from '../../../../src/renderer/pages/Classes/lib/students'
import {
  classNoFromName,
  computeAutoClassId,
  gradeToNumber,
} from '../../../../src/renderer/pages/Classes/class-id'

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

const all = [
  makeStudent({ name: '甲', class_id: 'G7-1', risk: '中' }),
  makeStudent({ name: '乙', class_id: 'G7-1', risk: '极高' }),
  makeStudent({ name: '丙', class_id: 'G7-2', risk: '低' }),
  makeStudent({ name: '丁', class_id: null, risk: '高' }),
  makeStudent({ name: '戊', class_id: 'G7-1', risk: '高' }),
  makeStudent({ name: '己', class_id: 'G7-1', risk: '低' }),
]

// ---------- filterClassStudents ----------

describe('filterClassStudents', () => {
  it('只保留本班学生并按风险等级排序(极高→低)', () => {
    const result = filterClassStudents(all, 'G7-1')
    expect(result.map((s) => s.name)).toEqual(['乙', '戊', '甲', '己'])
  })

  it('空输入返回空数组', () => {
    expect(filterClassStudents([], 'G7-1')).toEqual([])
  })

  it('无匹配班级返回空数组', () => {
    expect(filterClassStudents(all, 'G9-9')).toEqual([])
  })

  it('不修改原数组顺序', () => {
    const snapshot = all.map((s) => s.name)
    filterClassStudents(all, 'G7-1')
    expect(all.map((s) => s.name)).toEqual(snapshot)
  })
})

// ---------- filterAssignableStudents ----------

describe('filterAssignableStudents', () => {
  it('排除本班学生, 含未分班与其他班, 按姓名排序', () => {
    const result = filterAssignableStudents(all, 'G7-1')
    // 丙(G7-2) 与 丁(未分班) 可选, 不含 G7-1 的 甲乙戊己
    expect(result.map((s) => s.name)).toEqual(['丁', '丙'].sort((a, b) => a.localeCompare(b)))
    expect(result.every((s) => s.class_id !== 'G7-1')).toBe(true)
  })

  it('空输入返回空数组', () => {
    expect(filterAssignableStudents([], 'G7-1')).toEqual([])
  })

  it('全部同班时返回空数组', () => {
    expect(filterAssignableStudents([all[0], all[1]], 'G7-1')).toEqual([])
  })
})

// ---------- formatDate ----------

describe('formatDate', () => {
  it('月/日补零: 2026-01-05', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('双位月日不补零: 2026-12-31', () => {
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

// ---------- class-id ----------

describe('gradeToNumber', () => {
  it('中文年级映射: 一~九 → 1~9', () => {
    expect(gradeToNumber('一年级')).toBe('1')
    expect(gradeToNumber('七年级')).toBe('7')
    expect(gradeToNumber('九年级')).toBe('9')
  })

  it('含阿拉伯数字直接采用', () => {
    expect(gradeToNumber('7年级')).toBe('7')
    expect(gradeToNumber('Grade 8')).toBe('8')
  })

  it('含中文数字即命中: 高一 → 1(按字符匹配)', () => {
    expect(gradeToNumber('高一')).toBe('1')
  })

  it('无法识别返回 null(含空字符串)', () => {
    expect(gradeToNumber('')).toBeNull()
    expect(gradeToNumber('Prep')).toBeNull()
  })
})

describe('classNoFromName', () => {
  it('提取名称中首个数字串', () => {
    expect(classNoFromName('3班')).toBe('3')
    expect(classNoFromName('七年级12班')).toBe('12')
  })

  it('无数字返回 null', () => {
    expect(classNoFromName('重点班')).toBeNull()
    expect(classNoFromName('')).toBeNull()
  })
})

describe('computeAutoClassId', () => {
  it('七年级 + 3班 → G7-3', () => {
    expect(computeAutoClassId('七年级', '3班')).toBe('G7-3')
  })

  it('年级或班号无法识别返回 null', () => {
    expect(computeAutoClassId('', '3班')).toBeNull()
    expect(computeAutoClassId('七年级', '无数字')).toBeNull()
    expect(computeAutoClassId('Prep', '3班')).toBeNull()
  })
})