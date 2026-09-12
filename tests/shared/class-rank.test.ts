import { describe, expect, it } from 'vitest'
import { applyAutoClassRanks, competitionRanksByScoreDesc } from '../../src/shared/class-rank'

describe('competitionRanksByScoreDesc', () => {
  it('assigns competition ranks with ties', () => {
    expect(competitionRanksByScoreDesc([100, 95, 95, 90])).toEqual([1, 2, 2, 4])
  })

  it('handles single and empty', () => {
    expect(competitionRanksByScoreDesc([88])).toEqual([1])
    expect(competitionRanksByScoreDesc([])).toEqual([])
  })
})

describe('applyAutoClassRanks', () => {
  it('recomputes when >=2 students share exam+subject', () => {
    const out = applyAutoClassRanks([
      { examId: 'e1', subjectId: 'math', studentName: 'A', score: 90, classRank: 99 },
      { examId: 'e1', subjectId: 'math', studentName: 'B', score: 95 },
      { examId: 'e1', subjectId: 'math', studentName: 'C', score: 95 },
      { examId: 'e1', subjectId: 'math', studentName: 'D', score: null, classRank: 3 },
    ])
    const byName = Object.fromEntries(out.map((r) => [r.studentName, r]))
    expect(byName.B.classRank).toBe(1)
    expect(byName.C.classRank).toBe(1)
    expect(byName.A.classRank).toBe(3)
    expect(byName.D.classRank).toBeUndefined()
  })

  it('preserves hand rank for single-student subject groups', () => {
    const out = applyAutoClassRanks([
      { examId: 'e1', subjectId: 'math', studentName: 'A', score: 90, classRank: 7 },
      { examId: 'e1', subjectId: 'chinese', studentName: 'A', score: 120, classRank: 2 },
    ])
    expect(out.find((r) => r.subjectId === 'math')?.classRank).toBe(7)
    expect(out.find((r) => r.subjectId === 'chinese')?.classRank).toBe(2)
  })
})
