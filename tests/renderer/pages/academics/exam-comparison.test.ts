// =============================================================
// exam-comparison 单元测试 — 考试对比计算工具 (纯函数)
// 覆盖: computeScoreDelta / computeRankDelta / summarizeSubjects /
//       aggregateConductDelta / compareStudentGrades /
//       compareClassGrades / summarizeClassComparison
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAEventRecord, GradeRecord } from '@shared/types'
import {
  aggregateConductDelta,
  compareClassGrades,
  compareStudentGrades,
  computeRankDelta,
  computeScoreDelta,
  summarizeClassComparison,
  summarizeSubjects,
  type SubjectComparison,
} from '../../../../src/renderer/lib/academics'

// ---------- 数据工厂 ----------

function makeGrade(overrides: Partial<GradeRecord> = {}): GradeRecord {
  return {
    examId: 'exam-1',
    subjectId: 'chinese',
    studentName: '张三',
    score: 90,
    fullMark: 150,
    updatedAt: '2025-11-02T00:00:00Z',
    ...overrides,
  }
}

function makeEvent(overrides: Partial<EAAEventRecord> = {}): EAAEventRecord {
  return {
    event_id: 'ev-1',
    name: '张三',
    entity_id: 'ent-1',
    timestamp: '2025-11-05T00:00:00Z',
    event_type: 'ConductBonus',
    reason_code: 'rc',
    original_reason: 'help',
    score_delta: 2,
    note: '',
    tags: [],
    operator: 'teacher',
    is_valid: true,
    reverted_by: null,
    ...overrides,
  }
}

function sub(overrides: Partial<SubjectComparison>): SubjectComparison {
  return {
    subjectId: 'chinese',
    subjectName: '语文',
    scoreA: 80,
    scoreB: 90,
    fullMark: 150,
    scoreDelta: 10,
    classRankA: 5,
    classRankB: 3,
    classRankDelta: -2,
    gradeRankA: 10,
    gradeRankB: 8,
    gradeRankDelta: -2,
    ...overrides,
  }
}

// ---------- computeScoreDelta ----------

describe('computeScoreDelta', () => {
  it('正常计算 b - a', () => {
    expect(computeScoreDelta(80, 90)).toBe(10)
    expect(computeScoreDelta(100, 60)).toBe(-40)
    expect(computeScoreDelta(50, 50)).toBe(0)
  })

  it('任一为 null 返回 null', () => {
    expect(computeScoreDelta(null, 90)).toBeNull()
    expect(computeScoreDelta(80, null)).toBeNull()
    expect(computeScoreDelta(null, null)).toBeNull()
  })

  it('任一为 undefined 返回 null', () => {
    expect(computeScoreDelta(undefined as unknown as null, 90)).toBeNull()
    expect(computeScoreDelta(80, undefined as unknown as null)).toBeNull()
  })
})

// ---------- computeRankDelta ----------

describe('computeRankDelta', () => {
  it('正常计算 rankB - rankA (负=上升)', () => {
    expect(computeRankDelta(5, 3)).toBe(-2)
    expect(computeRankDelta(3, 5)).toBe(2)
  })

  it('任一为 null 返回 null', () => {
    expect(computeRankDelta(null, 3)).toBeNull()
    expect(computeRankDelta(3, null)).toBeNull()
  })
})

// ---------- summarizeSubjects ----------

describe('summarizeSubjects', () => {
  it('统计进步/退步/持平科目数', () => {
    const result = summarizeSubjects([
      sub({ scoreDelta: 10 }),
      sub({ scoreDelta: -5 }),
      sub({ scoreDelta: 0 }),
      sub({ scoreDelta: 3 }),
    ])
    expect(result).toEqual({ improved: 2, declined: 1, unchanged: 1 })
  })

  it('scoreDelta 为 null 的科目不计入', () => {
    const result = summarizeSubjects([
      sub({ scoreDelta: null }),
      sub({ scoreDelta: 10 }),
    ])
    expect(result).toEqual({ improved: 1, declined: 0, unchanged: 0 })
  })

  it('空数组返回全 0', () => {
    expect(summarizeSubjects([])).toEqual({ improved: 0, declined: 0, unchanged: 0 })
  })
})

// ---------- aggregateConductDelta ----------

describe('aggregateConductDelta', () => {
  it('累加有效事件的 score_delta', () => {
    const events = [
      makeEvent({ score_delta: 3 }),
      makeEvent({ score_delta: -1, event_type: 'ConductDeduct' }),
      makeEvent({ score_delta: 2 }),
    ]
    expect(aggregateConductDelta(events, '张三')).toBe(4)
  })

  it('只统计匹配学生的事件', () => {
    const events = [
      makeEvent({ name: '张三', score_delta: 3 }),
      makeEvent({ name: '李四', score_delta: 100 }),
    ]
    expect(aggregateConductDelta(events, '张三')).toBe(3)
  })

  it('过滤 is_valid = false 的事件', () => {
    const events = [
      makeEvent({ score_delta: 3 }),
      makeEvent({ score_delta: 5, is_valid: false }),
    ]
    expect(aggregateConductDelta(events, '张三')).toBe(3)
  })

  it('过滤已被冲正(reverted_by 非空)的事件', () => {
    const events = [
      makeEvent({ score_delta: 3 }),
      makeEvent({ score_delta: 5, reverted_by: 'ev-x' }),
      makeEvent({ score_delta: 5, reverted_by: '' }), // 空串视为未冲正
    ]
    expect(aggregateConductDelta(events, '张三')).toBe(8)
  })

  it('score_delta 缺失按 0 计', () => {
    const events = [makeEvent({ score_delta: undefined as unknown as number })]
    expect(aggregateConductDelta(events, '张三')).toBe(0)
  })

  it('空事件列表返回 0', () => {
    expect(aggregateConductDelta([], '张三')).toBe(0)
  })

  it('空学生名返回 0', () => {
    expect(aggregateConductDelta([makeEvent()], '')).toBe(0)
  })
})

// ---------- compareStudentGrades ----------

describe('compareStudentGrades', () => {
  const subjectMap = { chinese: '语文', math: '数学' }

  it('计算各科分数差与名次差', () => {
    const gradesA = [
      makeGrade({ subjectId: 'chinese', score: 80, classRank: 5, gradeRank: 20 }),
      makeGrade({ subjectId: 'math', score: 90, classRank: 2 }),
    ]
    const gradesB = [
      makeGrade({ subjectId: 'chinese', score: 88, classRank: 3, gradeRank: 15 }),
      makeGrade({ subjectId: 'math', score: 85, classRank: 4 }),
    ]
    const result = compareStudentGrades(gradesA, gradesB, subjectMap)

    expect(result.studentName).toBe('张三')
    expect(result.subjects).toHaveLength(2)

    const chinese = result.subjects.find((s) => s.subjectId === 'chinese')!
    expect(chinese.scoreA).toBe(80)
    expect(chinese.scoreB).toBe(88)
    expect(chinese.scoreDelta).toBe(8)
    expect(chinese.classRankDelta).toBe(-2)
    expect(chinese.gradeRankDelta).toBe(-5)

    const math = result.subjects.find((s) => s.subjectId === 'math')!
    expect(math.scoreDelta).toBe(-5)
    expect(math.classRankDelta).toBe(2)
    expect(math.gradeRankDelta).toBeNull() // gradeRank 两次均未录入
  })

  it('科目取并集,单侧缺失的科目 delta 为 null', () => {
    const gradesA = [makeGrade({ subjectId: 'chinese', score: 80 })]
    const gradesB = [makeGrade({ subjectId: 'math', score: 90 })]
    const result = compareStudentGrades(gradesA, gradesB, subjectMap)

    expect(result.subjects.map((s) => s.subjectId).sort()).toEqual(['chinese', 'math'])
    const chinese = result.subjects.find((s) => s.subjectId === 'chinese')!
    expect(chinese.scoreA).toBe(80)
    expect(chinese.scoreB).toBeNull()
    expect(chinese.scoreDelta).toBeNull()
  })

  it('subjectMap 缺失时回退用 subjectId 作为名称', () => {
    const result = compareStudentGrades(
      [makeGrade({ subjectId: 'chinese', score: 80 })],
      [makeGrade({ subjectId: 'chinese', score: 90 })],
      {},
    )
    expect(result.subjects[0].subjectName).toBe('chinese')
  })

  it('任一科目缺考则对应侧总分为 null', () => {
    const gradesA = [
      makeGrade({ subjectId: 'chinese', score: 80 }),
      makeGrade({ subjectId: 'math', score: 90 }),
    ]
    // B 侧数学缺考
    const gradesB = [makeGrade({ subjectId: 'chinese', score: 85 })]
    const result = compareStudentGrades(gradesA, gradesB, subjectMap)

    expect(result.totalScoreA).toBe(170)
    expect(result.totalScoreB).toBeNull()
    expect(result.totalScoreDelta).toBeNull()
  })

  it('两侧科目齐全时计算总分与总分差', () => {
    const gradesA = [
      makeGrade({ subjectId: 'chinese', score: 80 }),
      makeGrade({ subjectId: 'math', score: 90 }),
    ]
    const gradesB = [
      makeGrade({ subjectId: 'chinese', score: 85 }),
      makeGrade({ subjectId: 'math', score: 95 }),
    ]
    const result = compareStudentGrades(gradesA, gradesB, subjectMap)
    expect(result.totalScoreA).toBe(170)
    expect(result.totalScoreB).toBe(180)
    expect(result.totalScoreDelta).toBe(10)
  })

  it('统计进退步科目数', () => {
    const gradesA = [
      makeGrade({ subjectId: 'chinese', score: 80 }),
      makeGrade({ subjectId: 'math', score: 90 }),
      makeGrade({ subjectId: 'english', score: 70 }),
    ]
    const gradesB = [
      makeGrade({ subjectId: 'chinese', score: 85 }), // +5
      makeGrade({ subjectId: 'math', score: 85 }), // -5
      makeGrade({ subjectId: 'english', score: 70 }), // 0
    ]
    const result = compareStudentGrades(gradesA, gradesB, subjectMap)
    expect(result.improvedSubjects).toBe(1)
    expect(result.declinedSubjects).toBe(1)
    expect(result.unchangedSubjects).toBe(1)
  })

  it('conductDelta 透传,默认 null', () => {
    const grades = [makeGrade({ score: 80 })]
    expect(compareStudentGrades(grades, grades, {}).conductDelta).toBeNull()
    expect(compareStudentGrades(grades, grades, {}, 5).conductDelta).toBe(5)
  })

  it('两侧均空时返回空科目与空姓名', () => {
    const result = compareStudentGrades([], [], {})
    expect(result.studentName).toBe('')
    expect(result.subjects).toEqual([])
    expect(result.totalScoreA).toBeNull()
    expect(result.totalScoreB).toBeNull()
    expect(result.totalScoreDelta).toBeNull()
  })

  it('学生名回退到 B 侧首条记录', () => {
    const result = compareStudentGrades([], [makeGrade({ studentName: '李四', score: 80 })], {})
    expect(result.studentName).toBe('李四')
  })
})

// ---------- compareClassGrades ----------

describe('compareClassGrades', () => {
  const subjectMap = { chinese: '语文' }

  it('合并两侧学生并集', () => {
    const gradesA = {
      张三: [makeGrade({ studentName: '张三', score: 80 })],
    }
    const gradesB = {
      张三: [makeGrade({ studentName: '张三', score: 85 })],
      李四: [makeGrade({ studentName: '李四', score: 90 })],
    }
    const result = compareClassGrades(gradesA, gradesB, subjectMap)
    expect(result.map((s) => s.studentName).sort()).toEqual(['张三', '李四'])
  })

  it('按学生名映射 conductDeltas', () => {
    const gradesA = { 张三: [makeGrade({ studentName: '张三', score: 80 })] }
    const gradesB = { 张三: [makeGrade({ studentName: '张三', score: 80 })] }
    const result = compareClassGrades(gradesA, gradesB, subjectMap, { 张三: 7 })
    expect(result[0].conductDelta).toBe(7)
  })

  it('conductDeltas 中不存在的学生 conductDelta 为 null', () => {
    const gradesA = { 张三: [makeGrade({ studentName: '张三', score: 80 })] }
    const gradesB = { 张三: [makeGrade({ studentName: '张三', score: 80 })] }
    const result = compareClassGrades(gradesA, gradesB, subjectMap, { 李四: 3 })
    expect(result[0].conductDelta).toBeNull()
  })

  it('单侧缺失的学生另一侧按空数组处理', () => {
    const result = compareClassGrades(
      {},
      { 张三: [makeGrade({ studentName: '张三', score: 80 })] },
      subjectMap,
    )
    expect(result).toHaveLength(1)
    expect(result[0].totalScoreA).toBeNull()
    expect(result[0].totalScoreB).toBe(80)
  })

  it('空输入返回空数组', () => {
    expect(compareClassGrades({}, {}, {})).toEqual([])
  })
})

// ---------- summarizeClassComparison ----------

describe('summarizeClassComparison', () => {
  function studentComp(
    name: string,
    delta: number | null,
    subjectDeltas: Array<[string, string, number | null]> = [],
  ) {
    // delta=null 时 B 侧缺考,使 totalScoreDelta 为 null
    const base = compareStudentGrades(
      [makeGrade({ studentName: name, score: 80 })],
      [makeGrade({ studentName: name, score: delta === null ? null : 80 + delta })],
      {},
    )
    if (subjectDeltas.length > 0) {
      base.subjects = subjectDeltas.map(([id, sname, d]) =>
        sub({ subjectId: id, subjectName: sname, scoreDelta: d }),
      )
    }
    return base
  }

  it('空列表返回零值摘要', () => {
    const summary = summarizeClassComparison([])
    expect(summary.totalStudents).toBe(0)
    expect(summary.avgScoreDelta).toBe(0)
    expect(summary.mostImprovedStudent).toBeNull()
    expect(summary.mostDeclinedStudent).toBeNull()
    expect(summary.subjectDeltas).toEqual([])
  })

  it('计算平均总分变化并找出进步/退步最多学生', () => {
    const summary = summarizeClassComparison([
      studentComp('张三', 10),
      studentComp('李四', -20),
      studentComp('王五', 5),
    ])
    expect(summary.totalStudents).toBe(3)
    expect(summary.avgScoreDelta).toBeCloseTo(-5 / 3, 10)
    expect(summary.mostImprovedStudent).toBe('张三')
    expect(summary.mostImprovedDelta).toBe(10)
    expect(summary.mostDeclinedStudent).toBe('李四')
    expect(summary.mostDeclinedDelta).toBe(-20)
  })

  it('delta 为 null 的学生不计入平均与最值', () => {
    const summary = summarizeClassComparison([
      studentComp('张三', null),
      studentComp('李四', 8),
    ])
    expect(summary.avgScoreDelta).toBe(8)
    expect(summary.mostImprovedStudent).toBe('李四')
    expect(summary.mostDeclinedStudent).toBe('李四')
  })

  it('计算各科平均变化与样本数', () => {
    const s1 = studentComp('张三', 10, [
      ['chinese', '语文', 5],
      ['math', '数学', -3],
    ])
    const s2 = studentComp('李四', 10, [
      ['chinese', '语文', 7],
      ['math', '数学', null], // 无效不计入
    ])
    const summary = summarizeClassComparison([s1, s2])
    const map = new Map(summary.subjectDeltas.map((d) => [d.subjectId, d]))
    expect(map.get('chinese')).toMatchObject({ avgDelta: 6, sampleCount: 2 })
    expect(map.get('math')).toMatchObject({ avgDelta: -3, sampleCount: 1 })
  })

  it('全部持平 (delta=0) 时最值学生仍然产生', () => {
    const summary = summarizeClassComparison([studentComp('张三', 0)])
    expect(summary.mostImprovedStudent).toBe('张三')
    expect(summary.mostImprovedDelta).toBe(0)
    expect(summary.mostDeclinedStudent).toBe('张三')
    expect(summary.mostDeclinedDelta).toBe(0)
  })
})
