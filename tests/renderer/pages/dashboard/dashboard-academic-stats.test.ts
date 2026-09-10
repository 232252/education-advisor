// =============================================================
// dashboard-academic-stats — 成绩优先仪表盘纯函数测试
// 覆盖: 百分制分桶边界 / 缺考未录 / 单科原始分 / 排行与待关注排序
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAStudent } from '@shared/types'
import { SUBJECT_FILTER_ALL } from '../../../../src/renderer/pages/Dashboard/dashboard-lens'
import {
  computeAcademicStats,
  computeExamSubjectAvgs,
  computeGradeBands,
  computeStudentGradeRows,
  flattenClassGrades,
  GRADE_BAND_ORDER,
  pickLatestExamId,
  rankStudentGrades,
  watchlistStudents,
} from '../../../../src/renderer/pages/Dashboard/dashboard-academic-stats'
import { makeExam, makeGrade, makeStudent as makeStudentBase } from '../../__fixtures__/make'

const makeStudent = (overrides: Partial<EAAStudent> = {}): EAAStudent =>
  makeStudentBase({ name: '学生', entity_id: 'e1', ...overrides })

function bandCount(bands: Record<string, number>, needle: string): number {
  const key = GRADE_BAND_ORDER.find((k) => k.includes(needle))
  return key ? bands[key] : -1
}

describe('pickLatestExamId', () => {
  it('空列表返回空串', () => {
    expect(pickLatestExamId([])).toBe('')
  })

  it('按日期降序取最近一场', () => {
    const older = makeExam({ id: 'a', date: '2025-09-01' })
    const newer = makeExam({ id: 'b', date: '2025-11-01' })
    expect(pickLatestExamId([older, newer])).toBe('b')
  })
})

describe('computeStudentGradeRows', () => {
  const students = [
    makeStudent({ name: '甲', entity_id: 'e1' }),
    makeStudent({ name: '乙', entity_id: 'e2' }),
    makeStudent({ name: '丙', entity_id: 'e3' }),
  ]

  it('无成绩记录 → missing', () => {
    const rows = computeStudentGradeRows(students, {}, SUBJECT_FILTER_ALL)
    expect(rows.every((r) => r.status === 'missing')).toBe(true)
    expect(rows[0].kind).toBe('percent')
  })

  it('score=null → absent', () => {
    const rows = computeStudentGradeRows(
      [students[0]],
      { 甲: [makeGrade({ studentName: '甲', score: null, fullMark: 150 })] },
      'chinese',
    )
    expect(rows[0].status).toBe('absent')
    expect(rows[0].pct).toBeNull()
    expect(rows[0].kind).toBe('score')
  })

  it('全科：百分制均分；90/150 = 60% 为及格(ok)', () => {
    const rows = computeStudentGradeRows(
      [students[0]],
      {
        甲: [
          makeGrade({ studentName: '甲', subjectId: 'chinese', score: 90, fullMark: 150 }),
          makeGrade({ studentName: '甲', subjectId: 'math', score: 90, fullMark: 150 }),
        ],
      },
      SUBJECT_FILTER_ALL,
    )
    expect(rows[0].pct).toBeCloseTo(60, 10)
    expect(rows[0].status).toBe('ok')
    expect(rows[0].kind).toBe('percent')
  })

  it('全科：59.9% → fail', () => {
    const rows = computeStudentGradeRows(
      [students[0]],
      { 甲: [makeGrade({ studentName: '甲', score: 89.85, fullMark: 150 })] },
      SUBJECT_FILTER_ALL,
    )
    expect(rows[0].pct).toBeCloseTo(59.9, 5)
    expect(rows[0].status).toBe('fail')
  })

  it('单科：展示原始分', () => {
    const rows = computeStudentGradeRows(
      [students[0]],
      { 甲: [makeGrade({ studentName: '甲', subjectId: 'math', score: 120, fullMark: 150 })] },
      'math',
    )
    expect(rows[0].displayScore).toBe(120)
    expect(rows[0].pct).toBeCloseTo(80, 10)
    expect(rows[0].status).toBe('ok')
  })
})

describe('computeGradeBands', () => {
  it('空行：四桶均为 0', () => {
    const bands = computeGradeBands([])
    for (const k of GRADE_BAND_ORDER) expect(bands[k]).toBe(0)
  })

  it('边界: 59.9 fail / 60 pass / 75 good / 85 excellent；null 不计', () => {
    const rows = computeStudentGradeRows(
      [
        makeStudent({ name: 'a', entity_id: 'a' }),
        makeStudent({ name: 'b', entity_id: 'b' }),
        makeStudent({ name: 'c', entity_id: 'c' }),
        makeStudent({ name: 'd', entity_id: 'd' }),
        makeStudent({ name: 'e', entity_id: 'e' }),
      ],
      {
        a: [makeGrade({ studentName: 'a', score: 59.9, fullMark: 100 })],
        b: [makeGrade({ studentName: 'b', score: 60, fullMark: 100 })],
        c: [makeGrade({ studentName: 'c', score: 75, fullMark: 100 })],
        d: [makeGrade({ studentName: 'd', score: 85, fullMark: 100 })],
        e: [makeGrade({ studentName: 'e', score: null, fullMark: 100 })],
      },
      SUBJECT_FILTER_ALL,
    )
    const bands = computeGradeBands(rows)
    expect(bandCount(bands, '不及格')).toBe(1)
    expect(bandCount(bands, '及格')).toBe(1)
    expect(bandCount(bands, '良好')).toBe(1)
    expect(bandCount(bands, '优秀')).toBe(1)
  })
})

describe('computeAcademicStats / rank / watchlist', () => {
  const students = [
    makeStudent({ name: '高', entity_id: 'h' }),
    makeStudent({ name: '低', entity_id: 'l' }),
    makeStudent({ name: '缺', entity_id: 'a' }),
    makeStudent({ name: '空', entity_id: 'm' }),
  ]
  const classGrades = {
    高: [makeGrade({ studentName: '高', score: 90, fullMark: 100 })],
    低: [makeGrade({ studentName: '低', score: 50, fullMark: 100 })],
    缺: [makeGrade({ studentName: '缺', score: null, fullMark: 100 })],
  }

  it('录入/均分/缺考/待关注计数', () => {
    const rows = computeStudentGradeRows(students, classGrades, SUBJECT_FILTER_ALL)
    const stats = computeAcademicStats(rows, 3)
    expect(stats.examCount).toBe(3)
    expect(stats.studentCount).toBe(4)
    expect(stats.recordedCount).toBe(2)
    expect(stats.recordedLabel).toBe('2/4')
    expect(stats.avgPct).toBeCloseTo(70, 10)
    expect(stats.absentCount).toBe(2)
    expect(stats.lowCount).toBe(1)
  })

  it('排行只含有分数学生且降序', () => {
    const rows = computeStudentGradeRows(students, classGrades, SUBJECT_FILTER_ALL)
    const ranked = rankStudentGrades(rows)
    expect(ranked.map((r) => r.name)).toEqual(['高', '低'])
  })

  it('待关注：不及格 → 缺考 → 未录入', () => {
    const rows = computeStudentGradeRows(students, classGrades, SUBJECT_FILTER_ALL)
    expect(watchlistStudents(rows).map((r) => r.name)).toEqual(['低', '缺', '空'])
  })
})

describe('flattenClassGrades / computeExamSubjectAvgs', () => {
  it('展开后可算科目均分', () => {
    const flat = flattenClassGrades({
      甲: [makeGrade({ studentName: '甲', subjectId: 'chinese', score: 100, fullMark: 150 })],
      乙: [makeGrade({ studentName: '乙', subjectId: 'chinese', score: 50, fullMark: 150 })],
    })
    const avgs = computeExamSubjectAvgs(flat, [
      { id: 'chinese', name: '语文', category: 'core', fullMark: 150 },
      { id: 'math', name: '数学', category: 'core', fullMark: 150 },
    ])
    expect(avgs).toEqual([{ id: 'chinese', name: '语文', avg: 75 }])
  })
})
