// =============================================================
// grade-sheet 单元测试 — 成绩单行构建/排名/科目统计
// =============================================================

import type { EAAStudent, GradeRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildGradeSheetRows, computeSubjectStats } from '../grade-sheet'

function stu(name: string, classId: string | null = 'C1'): Pick<EAAStudent, 'name' | 'class_id'> {
  return { name, class_id: classId }
}

function grade(studentName: string, subjectId: string, score: number | null): GradeRecord {
  return {
    examId: 'exam-1',
    subjectId,
    studentName,
    score,
    fullMark: 100,
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

describe('buildGradeSheetRows', () => {
  it('计算各科分数与总分,按总分降序排名', () => {
    const students = [stu('甲'), stu('乙'), stu('丙')]
    const grades: Record<string, GradeRecord[]> = {
      甲: [grade('甲', 'math', 90), grade('甲', 'chinese', 80)],
      乙: [grade('乙', 'math', 95), grade('乙', 'chinese', 85)],
      丙: [grade('丙', 'math', 70), grade('丙', 'chinese', 60)],
    }
    const rows = buildGradeSheetRows(students, grades, ['math', 'chinese'])
    expect(rows.map((r) => r.name)).toEqual(['乙', '甲', '丙'])
    expect(rows[0].total).toBe(180)
    expect(rows[0].rank).toBe(1)
    expect(rows[2].rank).toBe(3)
  })

  it('同分同名次(竞争排名 1,2,2,4)', () => {
    const students = [stu('甲'), stu('乙'), stu('丙'), stu('丁')]
    const grades: Record<string, GradeRecord[]> = {
      甲: [grade('甲', 'math', 90)],
      乙: [grade('乙', 'math', 80)],
      丙: [grade('丙', 'math', 80)],
      丁: [grade('丁', 'math', 70)],
    }
    const rows = buildGradeSheetRows(students, grades, ['math'])
    const byName = new Map(rows.map((r) => [r.name, r.rank]))
    expect(byName.get('甲')).toBe(1)
    expect(byName.get('乙')).toBe(2)
    expect(byName.get('丙')).toBe(2)
    expect(byName.get('丁')).toBe(4)
  })

  it('缺考科目计 null 不计入总分', () => {
    const students = [stu('甲')]
    const grades: Record<string, GradeRecord[]> = {
      甲: [grade('甲', 'math', 90), grade('甲', 'chinese', null)],
    }
    const rows = buildGradeSheetRows(students, grades, ['math', 'chinese'])
    expect(rows[0].scores.chinese).toBeNull()
    expect(rows[0].total).toBe(90)
  })

  it('全部缺考的排在不参与排名区且无总分', () => {
    const students = [stu('甲'), stu('乙')]
    const grades: Record<string, GradeRecord[]> = {
      甲: [grade('甲', 'math', 90)],
      // 乙无任何成绩
    }
    const rows = buildGradeSheetRows(students, grades, ['math'])
    expect(rows[0].name).toBe('甲')
    expect(rows[1].name).toBe('乙')
    expect(rows[1].total).toBeNull()
    expect(rows[1].rank).toBeNull()
  })

  it('保留班级字段', () => {
    const rows = buildGradeSheetRows([stu('甲', 'G7-1')], {}, ['math'])
    expect(rows[0].classId).toBe('G7-1')
  })
})

describe('computeSubjectStats', () => {
  it('统计平均/最高/最低(忽略缺考)', () => {
    const rows = buildGradeSheetRows(
      [stu('甲'), stu('乙'), stu('丙')],
      {
        甲: [grade('甲', 'math', 90)],
        乙: [grade('乙', 'math', 70)],
        丙: [grade('丙', 'math', null)],
      },
      ['math'],
    )
    const stats = computeSubjectStats(rows, ['math'])
    expect(stats[0].count).toBe(2)
    expect(stats[0].average).toBe(80)
    expect(stats[0].max).toBe(90)
    expect(stats[0].min).toBe(70)
  })

  it('平均值保留一位小数', () => {
    const rows = buildGradeSheetRows(
      [stu('甲'), stu('乙'), stu('丙')],
      {
        甲: [grade('甲', 'math', 90)],
        乙: [grade('乙', 'math', 80)],
        丙: [grade('丙', 'math', 75)],
      },
      ['math'],
    )
    const stats = computeSubjectStats(rows, ['math'])
    expect(stats[0].average).toBe(81.7)
  })

  it('无任何分数时统计为空', () => {
    const stats = computeSubjectStats([], ['math'])
    expect(stats[0].count).toBe(0)
    expect(stats[0].average).toBeNull()
  })
})
