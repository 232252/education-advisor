// =============================================================
// 班级-考试归属纯函数测试
// 覆盖: 班内自动选考试(本班优先/回落全局)、他班考试标记口径
// =============================================================

import { describe, expect, it } from 'vitest'
import type { ExamDef } from '@shared/types'
import type { GradeRecord } from '@shared/types'
import {
  EXAM_FILTER_ALL,
  isForeignClassExam,
  mergeClassGrades,
  pickClassExamId,
} from '../../../../src/renderer/pages/Classes/lib/exam-scope'

const exam = (overrides: Partial<ExamDef>): ExamDef =>
  ({
    id: 'e',
    name: '通用技术专题一',
    type: 'test',
    date: '2026-09-20',
    semester: '2026-2027-1',
    scope: 'G12-9',
    subjects: ['通用技术'],
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  }) as ExamDef

describe('pickClassExamId — 班内自动选考试', () => {
  it('有本班考试 → 取本班最近一场(classId 优先,历史考试回落 scope)', () => {
    const exams = [
      exam({ id: 'other', classId: 'G12-5', scope: 'G12-5', date: '2026-09-21' }),
      exam({ id: 'mine-scope', date: '2026-09-20' }), // 仅 scope=G12-9
      exam({ id: 'mine-class', classId: 'G12-9', scope: 'G12-9', date: '2026-09-19' }),
    ]
    expect(pickClassExamId(exams, 'G12-9')).toBe('mine-scope')
  })

  it('无本班考试 → 回落全局最近一场(保持旧行为)', () => {
    const exams = [
      exam({ id: 'a', classId: 'G12-5', scope: 'G12-5', date: '2026-09-21' }),
      exam({ id: 'b', scope: '全年级', date: '2026-09-15' }),
    ]
    expect(pickClassExamId(exams, 'G12-9')).toBe('a')
  })

  it('不传班级 → 全局最近一场;空列表 → 空串', () => {
    const exams = [exam({ id: 'a', date: '2026-09-21' }), exam({ id: 'b', date: '2026-09-01' })]
    expect(pickClassExamId(exams, null)).toBe('a')
    expect(pickClassExamId([], 'G12-9')).toBe('')
  })
})

describe('isForeignClassExam — 他班考试标记口径', () => {
  it('仅认显式 classId:不同班 → true;scope 兼容历史/非班级口径不标记', () => {
    expect(isForeignClassExam(exam({ classId: 'G12-5' }), 'G12-9')).toBe(true)
    expect(isForeignClassExam(exam({ classId: 'G12-9' }), 'G12-9')).toBe(false)
    // 仅 scope(全年级/批改/历史考试)不标记,避免误伤
    expect(isForeignClassExam(exam({ scope: '全年级' }), 'G12-9')).toBe(false)
    expect(isForeignClassExam(exam(), 'G12-9')).toBe(false)
    expect(isForeignClassExam(exam({ classId: 'G12-5' }), null)).toBe(false)
  })
})

describe('mergeClassGrades — 「全部考试」按学生合并多场成绩', () => {
  it('同名学生 concat,空/缺失记录跳过,未出现的学生不生成键', () => {
    const merged = mergeClassGrades([
      { 张三: [{ examId: 'e1', subjectId: 'chinese', studentName: '张三', score: 90, updatedAt: 0 } as GradeRecord], 李四: [] },
      { 张三: [{ examId: 'e2', subjectId: 'math', studentName: '张三', score: 80, updatedAt: 0 } as GradeRecord] },
      {},
    ])
    expect(Object.keys(merged)).toEqual(['张三'])
    expect(merged['张三']).toHaveLength(2)
    expect(merged['张三'].map((g) => g.examId)).toEqual(['e1', 'e2'])
  })

  it('EXAM_FILTER_ALL 哨兵值不与真实考试 id 冲突', () => {
    expect(EXAM_FILTER_ALL).toBe('__ALL_EXAMS__')
  })
})
