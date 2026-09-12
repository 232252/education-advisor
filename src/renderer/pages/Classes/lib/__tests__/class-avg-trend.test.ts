import type { ExamDef, GradeRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { SUBJECT_FILTER_ALL } from '../../../Dashboard/dashboard-lens'
import {
  buildClassAvgTrend,
  computeExamClassAverage,
  pickTrendExams,
  trendPointsWithData,
} from '../class-avg-trend'

const exam = (id: string, date: string, semester = '2025-秋'): ExamDef => ({
  id,
  name: id,
  type: 'monthly',
  date,
  semester,
  subjects: ['math', 'chinese'],
  createdAt: date,
})

describe('pickTrendExams', () => {
  it('prefers same semester when >=2', () => {
    const exams = [
      exam('a', '2025-09-01', '2025-秋'),
      exam('b', '2025-10-01', '2025-秋'),
      exam('c', '2025-03-01', '2025-春'),
    ]
    const picked = pickTrendExams(exams, 'b')
    expect(picked.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('computeExamClassAverage / buildClassAvgTrend', () => {
  it('percent-normalizes all-subjects average', () => {
    const grades: Record<string, GradeRecord[]> = {
      甲: [
        {
          examId: 'e1',
          subjectId: 'math',
          studentName: '甲',
          score: 75,
          fullMark: 150,
          updatedAt: '',
        },
        {
          examId: 'e1',
          subjectId: 'chinese',
          studentName: '甲',
          score: 120,
          fullMark: 150,
          updatedAt: '',
        },
      ],
      乙: [
        {
          examId: 'e1',
          subjectId: 'math',
          studentName: '乙',
          score: 150,
          fullMark: 150,
          updatedAt: '',
        },
      ],
    }
    // 甲 mean pct = ((75/150)+(120/150))/2*100 = 65; 乙 = 100; class avg = 82.5
    const { average, recordedCount } = computeExamClassAverage(grades, SUBJECT_FILTER_ALL)
    expect(recordedCount).toBe(2)
    expect(average).toBeCloseTo(82.5, 5)
  })

  it('empty when fewer than 2 exams with data', () => {
    const exams = [exam('a', '2025-09-01'), exam('b', '2025-10-01')]
    const points = buildClassAvgTrend(
      exams,
      {
        a: {
          甲: [
            {
              examId: 'a',
              subjectId: 'math',
              studentName: '甲',
              score: 90,
              fullMark: 100,
              updatedAt: '',
            },
          ],
        },
        b: {},
      },
      'math',
    )
    expect(trendPointsWithData(points)).toHaveLength(1)
  })
})
