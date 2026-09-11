// =============================================================
// 批改域纯函数测试 — 生效分数合成 + 文件名→学生匹配
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  aiResultByQuestion,
  cleanPresetMarks,
  effectiveQuestionScore,
  effectiveTotalScore,
  groupPaperImportPaths,
  markScoreFromSelection,
  matchPaperFilesToStudents,
  matchIdentityToStudents,
  paperGroupKey,
  paperMarkOverlays,
  paperMarkScoreRows,
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

describe('markScoreFromSelection / cleanPresetMarks', () => {
  const marks = [
    { points: -2, note: '漏写单位' },
    { points: -5, note: '公式错误' },
    { points: 2, note: '步骤完整' },
  ]

  it('从满分加减并钳制到 [0, 满分]', () => {
    expect(markScoreFromSelection(10, marks, [])).toBe(10)
    expect(markScoreFromSelection(10, marks, [0])).toBe(8)
    expect(markScoreFromSelection(10, marks, [0, 1])).toBe(3)
    expect(markScoreFromSelection(10, marks, [1])).toBe(5)
    expect(markScoreFromSelection(10, marks, [1, 2])).toBe(7)
    expect(markScoreFromSelection(3, marks, [1])).toBe(0) // 10 会下溢,满分 3 → 0
    expect(markScoreFromSelection(10, marks, [99])).toBe(10) // 越界下标忽略
  })

  it('清洗空备注/非法分值', () => {
    expect(cleanPresetMarks(undefined)).toBeUndefined()
    expect(cleanPresetMarks([])).toBeUndefined()
    expect(cleanPresetMarks([{ points: -1, note: '  漏单位  ' }, { points: 1, note: '  ' }])).toEqual([
      { points: -1, note: '漏单位' },
    ])
  })
})

describe('groupPaperImportPaths / paperGroupKey', () => {
  it('中文名 + 页码 / 第N页 / pN 归为同一份', () => {
    expect(paperGroupKey('张三_1.jpg')).toBe(paperGroupKey('张三_2.jpg'))
    expect(paperGroupKey('张三第1页.png')).toBe(paperGroupKey('张三第2页.png'))
    expect(paperGroupKey('lisi_p1.jpg')).toBe(paperGroupKey('lisi_p2.jpg'))
    const grouped = groupPaperImportPaths([
      'C:\\scan\\张三_1.jpg',
      'C:\\scan\\张三_2.jpg',
      'D:/scan/李四.jpg',
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped[0]?.files).toHaveLength(2)
    expect(grouped[1]?.files).toHaveLength(1)
  })

  it('相机流水 IMG_001 不误合成一份', () => {
    const grouped = groupPaperImportPaths(['IMG_001.jpg', 'IMG_002.jpg', 'scan_01.png'])
    expect(grouped).toHaveLength(3)
  })

  it('空路径跳过; 保持选择顺序', () => {
    expect(groupPaperImportPaths([])).toEqual([])
    const grouped = groupPaperImportPaths(['b.jpg', '', 'a.jpg'])
    expect(grouped.map((g) => g.files[0]?.path)).toEqual(['b.jpg', 'a.jpg'])
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

describe('matchIdentityToStudents', () => {
  const roster = [
    { name: '张三', aliases: ['202601'] },
    { name: '张三丰', aliases: ['202602'] },
    { name: '李四', aliases: ['15'] },
  ]

  it('卷面姓名唯一命中优先于编号; 同名子串不猜', () => {
    expect(matchIdentityToStudents({ name: '李四', number: '' }, roster).suggested).toBe('李四')
    // 双向子串:「张三」命中张三与张三丰 → 不猜
    expect(matchIdentityToStudents({ name: '张三', number: '' }, roster).suggested).toBeNull()
    // 卷面写全名同样命中两人(张三丰.includes(张三)),与文档「不猜」一致
    expect(matchIdentityToStudents({ name: '张三丰', number: '' }, roster).suggested).toBeNull()
    expect(new Set(matchIdentityToStudents({ name: '张三丰', number: '' }, roster).candidates)).toEqual(
      new Set(['张三', '张三丰']),
    )
  })

  it('编号精确/后缀唯一命中; 单位数不后缀误伤', () => {
    expect(matchIdentityToStudents({ name: '', number: '202601' }, roster).suggested).toBe('张三')
    expect(matchIdentityToStudents({ name: '', number: '15' }, roster).suggested).toBe('李四')
    expect(matchIdentityToStudents({ name: '', number: '1' }, roster).suggested).toBeNull()
  })

  it('空白身份 → 无候选', () => {
    expect(matchIdentityToStudents({ name: '', number: '' }, roster)).toEqual({
      suggested: null,
      candidates: [],
    })
  })

  it('姓名唯一时即使考号对不上学号也按姓名归组', () => {
    const roster = [
      { name: '罗尧骋', aliases: ['20240005'] },
      { name: '阿的叶呷', aliases: ['20240006'] },
    ]
    const r = matchIdentityToStudents({ name: '罗尧骋', number: '20261001' }, roster)
    expect(r.suggested).toBe('罗尧骋')
    expect(r.candidates).toEqual(['罗尧骋'])
  })
})

describe('paperMarkScoreRows / paperMarkOverlays', () => {
  const rubric = [
    {
      id: 'q-1',
      title: '一、选择题',
      fullMark: 20,
      order: 1,
      presetMarks: [{ points: -2, note: '漏写单位' }],
    },
    { id: 'q-2', title: '二、填空', fullMark: 10, order: 2 },
  ]
  const paper = {
    ai: {
      questions: [
        {
          questionId: 'q-1',
          score: 18,
          comment: 'AI 评语',
          evidence: '第 3 小题错',
          appliedMarks: [0],
          box: { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
        },
        { questionId: 'q-2', score: 10, comment: '全对' },
      ],
      totalScore: 28,
      model: { provider: 'p', model: 'm' },
      finishedAt: '2026-01-01T00:00:00Z',
    },
  }

  it('逐题行: 教师评语/改分优先,评分点列出', () => {
    const rows = paperMarkScoreRows(
      {
        ...paper,
        review: {
          questions: { 'q-1': { score: 16, comment: '  教师评语  ', marks: [0] } },
          reviewedAt: '2026-01-02T00:00:00Z',
        },
      },
      rubric,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      title: '一、选择题',
      fullMark: 20,
      score: 16,
      comment: '教师评语',
      evidence: '第 3 小题错',
      markNotes: ['-2 漏写单位'],
    })
    expect(rows[1].score).toBe(10)
    expect(rows[1].comment).toBe('全对')
  })

  it('叠字只要有 box 的题;文案含生效分', () => {
    const overlays = paperMarkOverlays(paper, rubric)
    expect(overlays).toHaveLength(1)
    expect(overlays[0]).toMatchObject({
      questionId: 'q-1',
      page: 0,
      x: 0.1,
      y: 0.2,
    })
    expect(overlays[0].text).toContain('一、选择题')
    expect(overlays[0].text).toContain('18/20')
    expect(overlays[0].text).toContain('AI 评语')
  })

  it('无 AI 结果仍输出量规行,无叠字', () => {
    expect(paperMarkScoreRows({ ai: undefined }, rubric).map((r) => r.score)).toEqual([null, null])
    expect(paperMarkOverlays({ ai: undefined }, rubric)).toEqual([])
  })
})
