// =============================================================
// Classes/lib 纯函数 — 班级均分趋势与两考进退统计测试
// 口径锁定: subject=all 走 meanPct(score/fullMark×100),
// 单科走 meanRaw;null 缺考排除、0 分计入;趋势锚定同学期池、
// 超 8 场取最近 8 场;进退统计忽略 null delta。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { ExamDef, GradeRecord } from '@shared/types'
import { SUBJECT_FILTER_ALL } from '@renderer/pages/Dashboard/dashboard-lens'
import {
  buildClassAvgTrend,
  computeExamClassAverage,
  pickTrendExams,
  trendPointsWithData,
} from '../../../../src/renderer/pages/Classes/lib/class-avg-trend'
import { summarizeScoreMovement } from '../../../../src/renderer/pages/Classes/lib/grade-movement'

function exam(id: string, date: string, semester?: string): ExamDef {
  return { id, name: 'E-' + id, date, semester } as ExamDef
}

function g(subjectId: string, score: number | null, fullMark = 100): GradeRecord {
  return { subjectId, score, fullMark } as GradeRecord
}

describe('pickTrendExams', () => {
  it('空考试列表返回空', () => {
    expect(pickTrendExams([], 'any')).toEqual([])
  })

  it('锚考试同学期 ≥2 场: 只用同学期池且按日期升序', () => {
    const exams = [
      exam('s1e2', '2026-03-02', '2026春'),
      exam('prev', '2025-12-30', '2025秋'),
      exam('s1e1', '2026-03-01', '2026春'),
    ]
    expect(pickTrendExams(exams, 's1e1').map((e) => e.id)).toEqual(['s1e1', 's1e2'])
  })

  it('同学期不足 2 场回落全量池;锚不存在同样全量', () => {
    const exams = [exam('a', '2026-01-01', '孤学期'), exam('b', '2026-02-01')]
    expect(pickTrendExams(exams, 'a').map((e) => e.id)).toEqual(['a', 'b'])
    expect(pickTrendExams(exams, 'ghost').map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('池超 8 场取最近 8 场(升序)', () => {
    const exams = Array.from({ length: 11 }, (_, i) =>
      exam('e' + i, '2026-' + String(i + 1).padStart(2, '0') + '-01'),
    )
    const picked = pickTrendExams(exams, 'e0')
    expect(picked).toHaveLength(8)
    expect(picked[0].id).toBe('e3')
    expect(picked[7].id).toBe('e10')
  })
})

describe('computeExamClassAverage', () => {
  it('全科口径 meanPct: 混合满分归一,缺考排除,0 分计入', () => {
    const byStudent = {
      A: [g('chinese', 80), g('math', 90)],
      B: [g('chinese', 60), g('math', null)],
      C: [g('chinese', 0, 50)],
      D: [g('chinese', null)],
    }
    const r = computeExamClassAverage(byStudent, SUBJECT_FILTER_ALL)
    // A=85, B=60(缺考排除), C=0(计入), D=null
    expect(r.average).toBeCloseTo((85 + 60 + 0) / 3, 10)
    expect(r.recordedCount).toBe(3)
  })

  it('单科口径 meanRaw: 只统计该科目原始分', () => {
    const byStudent = {
      A: [g('math', 90), g('chinese', 50)],
      B: [g('chinese', 70)],
    }
    const r = computeExamClassAverage(byStudent, 'math')
    expect(r.average).toBe(90)
    expect(r.recordedCount).toBe(1)
  })

  it('无任何有效分数: average null 且 0 记录', () => {
    expect(computeExamClassAverage({}, 'math')).toEqual({ average: null, recordedCount: 0 })
    expect(computeExamClassAverage({ A: [g('math', null)] }, 'math')).toEqual({
      average: null,
      recordedCount: 0,
    })
  })
})

describe('buildClassAvgTrend / trendPointsWithData', () => {
  it('点序随考试序,均值保留 1 位小数,缺数据场为 null', () => {
    const exams = [exam('e1', '2026-01-01'), exam('e2', '2026-02-01'), exam('e3', '2026-03-01')]
    const gradesByExam = {
      e1: { A: [g('chinese', 85.01), g('math', 60.03)] }, // 均值 72.52 → 72.5
      e2: { A: [g('chinese', 90)] },
      // e3 无数据
    }
    const points = buildClassAvgTrend(exams, gradesByExam, SUBJECT_FILTER_ALL)
    expect(points.map((p) => p.examId)).toEqual(['e1', 'e2', 'e3'])
    expect(points[0].average).toBe(72.5)
    expect(points[1].average).toBe(90)
    expect(points[2].average).toBeNull()
    expect(points[0]).toMatchObject({ examName: 'E-e1', date: '2026-01-01', recordedCount: 1 })

    expect(trendPointsWithData(points)).toHaveLength(2)
  })
})

describe('summarizeScoreMovement', () => {
  it('正负零分别计数,null delta 忽略', () => {
    const r = summarizeScoreMovement([
      { totalScoreDelta: 5 },
      { totalScoreDelta: -3 },
      { totalScoreDelta: 0 },
      { totalScoreDelta: 12 },
      { totalScoreDelta: null },
      { totalScoreDelta: -1 },
    ])
    expect(r).toEqual({ improved: 2, declined: 2, flat: 1 })
  })
})