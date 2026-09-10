// =============================================================
// Grading Publish 纯函数测试
// 覆盖: questionSubjectIds(顺序前缀+去重+总分保留) /
//       buildPublishPayload(逐题+总分记录/覆盖口径/跳过原因/溯源 note)
// =============================================================

import { describe, expect, it } from 'vitest'
import type { GradingTask } from '../../src/shared/types'
import {
  buildPublishPayload,
  questionSubjectIds,
  TOTAL_SUBJECT_ID,
} from '../../src/main/services/grading/publish'

function makeTask(overrides: Partial<GradingTask> = {}): GradingTask {
  return {
    id: 'grading-t1',
    name: '数学周测',
    semester: '2026-秋',
    status: 'review',
    examDate: '2026-09-01',
    rubric: [
      { id: 'q-1', title: '选择题', fullMark: 30, order: 1 },
      { id: 'q-2', title: '解答题', fullMark: 20, order: 2 },
    ],
    papers: [],
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  }
}

describe('questionSubjectIds', () => {
  it('顺序前缀天然去重(同名题目不同序号); 与总分不冲突', () => {
    const ids = questionSubjectIds([
      { id: 'q-1', title: '解答题', fullMark: 10, order: 1 },
      { id: 'q-2', title: '解答题', fullMark: 10, order: 2 },
      { id: 'q-3', title: '总分', fullMark: 10, order: 3 },
    ])
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('1.解答题')
    expect(ids[1]).toBe('2.解答题') // 序号前缀已保证同名不撞
    expect(ids[2]).toBe('3.总分')
    expect(ids).not.toContain(TOTAL_SUBJECT_ID)
  })
})

describe('buildPublishPayload', () => {
  it('逐题+总分记录; 覆盖优先; note 溯源; 考试含全部科目', () => {
    const task = makeTask({
      papers: [
        {
          id: 'paper-1',
          studentName: '张三',
          files: [],
          uploadedAt: '2026-09-08T10:00:00.000Z',
          status: 'graded',
          ai: {
            questions: [
              { questionId: 'q-1', score: 28 },
              { questionId: 'q-2', score: 15 },
            ],
            totalScore: 43,
            model: { provider: 'p', model: 'm' },
            finishedAt: '2026-09-08T10:05:00.000Z',
          },
          review: { questions: { 'q-1': { score: 30 } }, reviewedAt: '2026-09-08T11:00:00.000Z' },
        },
      ],
    })
    const payload = buildPublishPayload(task)
    expect(payload.examInput).toMatchObject({
      name: '数学周测',
      type: 'other',
      date: '2026-09-01',
      semester: '2026-秋',
      scope: 'ai-grading',
    })
    expect(payload.examInput.subjects).toEqual(['1.选择题', '2.解答题', TOTAL_SUBJECT_ID])
    expect(payload.records).toHaveLength(3) // 两题 + 总分
    const q1 = payload.records[0]
    expect(q1).toMatchObject({ subjectId: '1.选择题', studentName: '张三', score: 30, fullMark: 30 })
    expect(q1?.note).toContain('AI批改')
    const total = payload.records[2]
    expect(total).toMatchObject({ subjectId: TOTAL_SUBJECT_ID, score: 45, fullMark: 50 }) // 30+15
    expect(payload.skipped).toEqual([])
  })

  it('未归组/未批改/分数不完整 → skipped,不发记录', () => {
    const task = makeTask({
      papers: [
        {
          id: 'paper-1',
          studentName: null,
          files: [],
          uploadedAt: '',
          status: 'unassigned',
        },
        {
          id: 'paper-2',
          studentName: '李四',
          files: [],
          uploadedAt: '',
          status: 'failed',
          error: 'boom',
        },
      ],
    })
    const payload = buildPublishPayload(task)
    expect(payload.records).toEqual([])
    expect(payload.skipped.map((s) => s.reason)).toEqual(['未归组', '未批改'])
  })

  it('examDate 缺省时用创建日期', () => {
    const payload = buildPublishPayload(makeTask({ examDate: undefined }))
    expect(payload.examInput.date).toBe('2026-09-08')
  })

  it('同一学生两份试卷只发布先出现的,后者 skipped 不覆盖', () => {
    const ai = {
      questions: [
        { questionId: 'q-1', score: 10 },
        { questionId: 'q-2', score: 10 },
      ],
      totalScore: 20,
      model: { provider: 'p', model: 'm' },
      finishedAt: '2026-09-08T10:05:00.000Z',
    }
    const payload = buildPublishPayload(
      makeTask({
        papers: [
          {
            id: 'paper-first',
            studentName: '张三',
            files: [],
            uploadedAt: '',
            status: 'graded',
            ai: { ...ai, totalScore: 20 },
          },
          {
            id: 'paper-dup',
            studentName: '张三',
            files: [],
            uploadedAt: '',
            status: 'graded',
            ai: { ...ai, totalScore: 50, questions: [
              { questionId: 'q-1', score: 30 },
              { questionId: 'q-2', score: 20 },
            ] },
          },
        ],
      }),
    )
    const totals = payload.records.filter((r) => r.subjectId === TOTAL_SUBJECT_ID)
    expect(totals).toHaveLength(1)
    expect(totals[0]?.score).toBe(20)
    expect(payload.skipped).toEqual([
      {
        paperId: 'paper-dup',
        studentName: '张三',
        reason: '同学生已有另一份试卷，跳过以免覆盖成绩',
      },
    ])
  })
})
