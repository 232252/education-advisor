// =============================================================
// 批改域纯函数测试 — 生效分数合成 + 文件名→学生匹配
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  aiResultByQuestion,
  effectiveQuestionScore,
  effectiveTotalScore,
  matchPaperFilesToStudents,
  rubricFullMark,
} from '../../src/shared/grading-helpers'

describe('effectiveQuestionScore / effectiveTotalScore', () => {
  const paper = {
    ai: {
      questions: [
        { questionId: 'q-1', score: 28 },
        { questionId: 'q-2', score: 15 },
      ],
      totalScore: 43,
      model: { provider: 'p', model: 'm' },
      finishedAt: '2026-01-01T00:00:00Z',
    },
  }

  it('AI 分生效; 覆盖优先; 无结果 → null', () => {
    expect(effectiveQuestionScore(paper, 'q-1')).toBe(28)
    expect(effectiveQuestionScore({ ...paper, review: { questions: { 'q-1': { score: 30 } } } }, 'q-1')).toBe(30)
    expect(effectiveQuestionScore(paper, 'q-404')).toBeNull()
    expect(effectiveQuestionScore({ ai: undefined }, 'q-1')).toBeNull()
  })

  it('总分求和; 任一题缺分 → null', () => {
    expect(effectiveTotalScore(paper)).toBe(43)
    expect(
      effectiveTotalScore({
        ai: { ...paper.ai, questions: [{ questionId: 'q-1', score: 10 }] },
      }),
    ).toBe(10)
    expect(effectiveTotalScore({ ai: undefined })).toBeNull()
    // 覆盖不影响合计的完整性(覆盖也是分)
    expect(
      effectiveTotalScore({ ...paper, review: { questions: { 'q-1': { score: 0 } } } }),
    ).toBe(15)
  })

  it('rubricFullMark 求和且容忍非法值', () => {
    expect(
      rubricFullMark([
        { id: 'q-1', title: 'a', fullMark: 30, order: 1 },
        { id: 'q-2', title: 'b', fullMark: 20, order: 2 },
      ]),
    ).toBe(50)
    expect(rubricFullMark([])).toBe(0)
  })

  it('aiResultByQuestion 索引', () => {
    const map = aiResultByQuestion(paper.ai)
    expect(map.get('q-1')?.score).toBe(28)
    expect(map.size).toBe(2)
    expect(aiResultByQuestion(undefined).size).toBe(0)
  })
})

describe('matchPaperFilesToStudents', () => {
  const students = [
    { name: '张三' },
    { name: '张三丰' },
    { name: '李四', aliases: ['小李子'] },
  ]

  it('唯一命中 → suggested; 多命中 → ambiguous 候选', () => {
    const [unique, ambiguous, prefixOnly] = matchPaperFilesToStudents(
      [
        { paperId: 'p1', fileName: '李四 数学卷.jpg' },
        { paperId: 'p2', fileName: '张三丰.jpg' },
        { paperId: 'p3', fileName: '张三_1.jpg' },
      ],
      students,
    )
    expect(unique.suggested).toBe('李四')
    // '张三丰' 同时包含 '张三' 与 '张三丰' → 歧义,人工指认
    expect(ambiguous.suggested).toBeNull()
    expect(new Set(ambiguous.candidates)).toEqual(new Set(['张三', '张三丰']))
    // '张三1' 只包含 '张三'(不包含 '张三丰') → 唯一命中
    expect(prefixOnly.suggested).toBe('张三')
  })

  it('归一化: 扩展名/空白/分隔符/大小写不敏感; 别名可命中', () => {
    const results = matchPaperFilesToStudents(
      [
        { paperId: 'a', fileName: 'zhangsan-final.PNG' },
        { paperId: 'b', fileName: '小李子.jpg' },
        { paperId: 'c', fileName: 'IMG_20260908_001.jpg' },
      ],
      [...students, { name: 'ZhangSan' }],
    )
    expect(results[0]?.suggested).toBe('ZhangSan')
    expect(results[1]?.suggested).toBe('李四')
    expect(results[2]?.suggested).toBeNull()
    expect(results[2]?.candidates).toEqual([])
  })

  it('空名单/空文件安全', () => {
    expect(matchPaperFilesToStudents([], students)).toEqual([])
    expect(matchPaperFilesToStudents([{ paperId: 'x', fileName: 'a.jpg' }], [])).toEqual([
      { paperId: 'x', fileName: 'a.jpg', suggested: null, candidates: [] },
    ])
  })
})
