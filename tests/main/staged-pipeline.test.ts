// =============================================================
// Staged Pipeline 纯函数测试
// 覆盖: planStagedBatches(题型排序+转写判定) / parseReferenceAnswers(四种形态)
//       / parseTranscribeResponse / perSubQuestionMark / ruleScoreQuestion
//       / parseStagedGradeResponse / parseLocateResponse / expandBox / mapCropBoxToPage
// 依赖 mock: 与 grading-pipeline.test.ts 同套(模块级 import 保可加载)。
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/staged-pipeline-test-${Date.now()}`
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})
vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => ({}) },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: () => undefined },
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: {},
}))

import {
  buildStagedGradePrompt,
  expandBox,
  isRuleScoreable,
  mapCropBoxToPage,
  normalizeObjectiveValue,
  parseLocateResponse,
  parseReferenceAnswers,
  parseStagedGradeResponse,
  parseTranscribeResponse,
  perSubQuestionMark,
  planStagedBatches,
  ruleScoreQuestion,
} from '../../src/main/services/grading/staged-pipeline'

import type { RubricQuestion } from '@shared/types'

function q(partial: Partial<RubricQuestion> & { id: string; title: string }): RubricQuestion {
  return { fullMark: 10, order: 1, ...partial }
}

describe('planStagedBatches — 题型排序与批次类型', () => {
  const rubric = [
    q({ id: 'q-4', title: '三、计算题', fullMark: 30, order: 4 }),
    q({ id: 'q-1', title: '一、单选题（每小题6分，共5小题）', fullMark: 30, order: 1, referenceAnswer: '1-5 BACDA' }),
    q({ id: 'q-3', title: '三、填空题', fullMark: 16, order: 3, referenceAnswer: '见解析' }),
    q({ id: 'q-2', title: '二、多选题', fullMark: 12, order: 2, referenceAnswer: '1-2 AC BD' }),
  ]

  it('顺序: 单选 → 多选 → 填空 → 其他;单选参考可解析走转写批', () => {
    const batches = planStagedBatches(rubric)
    expect(batches.map((b) => b.question.id)).toEqual(['q-1', 'q-2', 'q-3', 'q-4'])
    expect(batches[0]?.kind).toBe('transcribe')
    expect(batches[1]?.kind).toBe('grade') // 多选不走规则判分(少选政策因考试而异)
    expect(batches[2]?.kind).toBe('grade')
    expect(batches[3]?.kind).toBe('grade')
  })

  it('单选参考答案不可解析 → 回落聚焦批', () => {
    const batches = planStagedBatches([
      q({ id: 'q-1', title: '一、单选题', referenceAnswer: '略' }),
    ])
    expect(batches[0]?.kind).toBe('grade')
  })

  it('isRuleScoreable: 判断题可解析为 true;主观题为 false', () => {
    expect(isRuleScoreable(q({ id: 'a', title: '判断题', referenceAnswer: '√×√√' }))).toBe(true)
    expect(isRuleScoreable(q({ id: 'b', title: '解答题', referenceAnswer: 'BACDA' }))).toBe(false)
  })
})

describe('parseReferenceAnswers — 四种形态', () => {
  it('裸字母序列 BACDA', () => {
    const ref = parseReferenceAnswers('BACDA')
    expect(ref).not.toBeNull()
    expect([...(ref as Map<number, string>)].slice(0, 5)).toEqual([
      [1, 'B'],
      [2, 'A'],
      [3, 'C'],
      [4, 'D'],
      [5, 'A'],
    ])
  })

  it('区段 1-5 BACDA 6-10 CCDAB', () => {
    const ref = parseReferenceAnswers('1-5 BACDA 6-10 CCDAB')
    expect(ref?.size).toBe(10)
    expect(ref?.get(6)).toBe('C')
    expect(ref?.get(10)).toBe('B')
  })

  it('逐题对 1.B 2.A 3.C 与判断 √×√', () => {
    const pairs = parseReferenceAnswers('1.B 2.A 3.C')
    expect(pairs?.size).toBe(3)
    expect(pairs?.get(2)).toBe('A')
    const tf = parseReferenceAnswers('√×√')
    expect(tf?.get(1)).toBe('√')
    expect(tf?.get(2)).toBe('×')
  })

  it('判断中文/TF 序列归一为 √/×', () => {
    const zh = parseReferenceAnswers('对错对')
    expect([...(zh as Map<number, string>)]).toEqual([
      [1, '√'],
      [2, '×'],
      [3, '√'],
    ])
    const en = parseReferenceAnswers('TTFF')
    expect(en?.get(2)).toBe('√')
    expect(en?.get(3)).toBe('×')
  })

  it('解析不出/题号冲突 → null', () => {
    expect(parseReferenceAnswers('本题考查牛顿第二定律的综合应用')).toBeNull()
    expect(parseReferenceAnswers('1.B 1.A')).toBeNull()
    expect(parseReferenceAnswers(undefined)).toBeNull()
    expect(parseReferenceAnswers('')).toBeNull()
  })
})

describe('normalizeObjectiveValue', () => {
  it('字母大写/判断归一/多选字母组', () => {
    expect(normalizeObjectiveValue('b')).toBe('B')
    expect(normalizeObjectiveValue('ac')).toBe('AC')
    expect(normalizeObjectiveValue('对')).toBe('√')
    expect(normalizeObjectiveValue('F')).toBe('×')
    expect(normalizeObjectiveValue('')).toBe('')
    expect(normalizeObjectiveValue('D')).toBe('D')
  })
})

describe('parseTranscribeResponse', () => {
  it('数组形态 + uncertain 标记 + 归一', () => {
    const items = parseTranscribeResponse(
      '```json\n{"answers":[{"no":1,"value":"b"},{"no":2,"value":"A","uncertain":true},{"no":3,"value":""}]}\n```',
    )
    expect(items).toEqual([
      { no: 1, value: 'B', uncertain: false },
      { no: 2, value: 'A', uncertain: true },
      { no: 3, value: '', uncertain: false },
    ])
  })

  it('对象形态 {小题号:值}', () => {
    const items = parseTranscribeResponse('{"answers":{"1":"B","2":"C"}}')
    expect(items.length).toBe(2)
    expect(items[1]).toEqual({ no: 2, value: 'C', uncertain: false })
  })

  it('同题号去重保留最后;无可用作答抛错', () => {
    const items = parseTranscribeResponse('{"answers":[{"no":1,"value":"A"},{"no":1,"value":"B"}]}')
    expect(items).toEqual([{ no: 1, value: 'B', uncertain: false }])
    expect(() => parseTranscribeResponse('{"foo":1}')).toThrow()
  })
})

describe('perSubQuestionMark + ruleScoreQuestion', () => {
  const choice = q({
    id: 'q-1',
    title: '一、单选题（每小题6分，共5小题）',
    fullMark: 30,
    referenceAnswer: '1-5 BACDA',
    presetMarks: [
      { points: -6, note: '第1小题错' },
      { points: -6, note: '第2小题错' },
    ],
  })

  it('每小题分值: 评分点优先,否则满分/小题数', () => {
    expect(perSubQuestionMark(choice, 5)).toBe(6)
    expect(perSubQuestionMark(q({ id: 'x', title: '单选题', fullMark: 50 }), 10)).toBe(5)
    expect(perSubQuestionMark(q({ id: 'x', title: '单选题', fullMark: 8 }), 0)).toBe(8)
  })

  it('判分: 错2/5 → 18 分,扣分项与依据;未作答按错计', () => {
    const ref = parseReferenceAnswers('BACDA') as Map<number, string>
    const outcome = ruleScoreQuestion(choice, ref, [
      { no: 1, value: 'B', uncertain: false },
      { no: 2, value: 'D', uncertain: false },
      { no: 3, value: 'C', uncertain: false },
      { no: 4, value: '', uncertain: false },
      { no: 5, value: 'a', uncertain: false },
    ])
    expect(outcome.result.score).toBe(18) // 错第2、未答第4 → 30-12
    expect(outcome.result.deductions?.length).toBe(2)
    expect(outcome.result.deductions?.[0]?.reason).toContain('应为A')
    expect(outcome.result.deductions?.[1]?.reason).toContain('未作答')
    expect(outcome.result.evidence).toContain('3/5')
    expect(outcome.uncertainNos).toEqual([])
  })

  it('uncertain 小题进复验清单;全对无扣分项', () => {
    const ref = parseReferenceAnswers('BACDA') as Map<number, string>
    const wrong = ruleScoreQuestion(choice, ref, [
      { no: 1, value: 'B', uncertain: false },
      { no: 2, value: 'C', uncertain: true },
      { no: 3, value: 'C', uncertain: false },
      { no: 4, value: 'D', uncertain: false },
      { no: 5, value: 'A', uncertain: false },
    ])
    expect(wrong.uncertainNos).toEqual([2])
    const full = ruleScoreQuestion(choice, ref, [
      { no: 1, value: 'B', uncertain: false },
      { no: 2, value: 'A', uncertain: false },
      { no: 3, value: 'C', uncertain: false },
      { no: 4, value: 'D', uncertain: false },
      { no: 5, value: 'A', uncertain: false },
    ])
    expect(full.result.score).toBe(30)
    expect(full.result.deductions).toBeUndefined()
  })
})

describe('buildStagedGradePrompt + parseStagedGradeResponse', () => {
  const subjective = q({
    id: 'q-9',
    title: '三、计算题',
    fullMark: 16,
    referenceAnswer: '(1) 6m/s (2) 0.5m',
    presetMarks: [
      { points: -8, note: '(1) 过程或结果错' },
      { points: -8, note: '(2) 过程或结果错' },
    ],
  })

  it('prompt 注入题目/满分/评分标准/评分点', () => {
    const p = buildStagedGradePrompt(subjective, 'normal')
    expect(p).toContain('三、计算题')
    expect(p).toContain('满分: 16')
    expect(p).toContain('(1) 6m/s')
    expect(p).toContain('[0] (1) 过程或结果错')
    expect(p).toContain('marks')
  })

  it('裸对象解析: marks 合成分数 + deductions + box', () => {
    const r = parseStagedGradeResponse(
      '{"score":99,"marks":[0],"evidence":"依据：第(2)问错误","deductions":[{"points":8,"reason":"第(2)问错误"}],"box":{"page":1,"x":0.1,"y":0.2,"w":0.5,"h":0.3}}',
      subjective,
    )
    expect(r.score).toBe(8) // 16 + (-8)
    expect(r.appliedMarks).toEqual([0])
    expect(r.deductions?.[0]?.points).toBe(8)
    expect(r.box?.page).toBe(1)
  })

  it('questions 数组包裹取首个;越界钳制;缺 score 抛错', () => {
    const wrapped = parseStagedGradeResponse(
      '{"questions":[{"score":20,"evidence":"ok"}]}',
      subjective,
    )
    expect(wrapped.score).toBe(16) // 钳制
    expect(() => parseStagedGradeResponse('{"evidence":"无分"}', subjective)).toThrow()
  })
})

describe('parseLocateResponse + 裁剪几何', () => {
  const rubric = [
    q({ id: 'q-1', title: '一、单选题' }),
    q({ id: 'q-2', title: '二、填空题' }),
  ]

  it('合法 box 收录;未知题/坏 box 丢弃;负坐标钳制收录;垃圾输出空表', () => {
    const ok = parseLocateResponse(
      '{"boxes":[{"questionId":"q-1","page":0,"x":0.1,"y":0.1,"w":0.8,"h":0.2},{"questionId":"q-9","page":0,"x":0,"y":0,"w":1,"h":1},{"questionId":"q-2","page":1,"x":"bad","y":0,"w":0.5,"h":0.2}]}',
      rubric,
    )
    expect(ok.size).toBe(1)
    expect(ok.get('q-1')?.page).toBe(0)
    expect(parseLocateResponse('not json at all', rubric).size).toBe(0)
  })

  it('expandBox 外扩并钳在页内;mapCropBoxToPage 线性映射', () => {
    // 每边外扩 box 边长的 20%: x=0.5-0.02=0.48, w=0.1×1.4=0.14
    const expanded = expandBox({ page: 0, x: 0.5, y: 0.5, w: 0.1, h: 0.1 })
    expect(expanded.x).toBeCloseTo(0.48)
    expect(expanded.w).toBeCloseTo(0.14)
    const atEdge = expandBox({ page: 0, x: 0.98, y: 0.0, w: 0.02, h: 0.02 })
    expect(atEdge.x + atEdge.w).toBeLessThanOrEqual(1.0000001)
    expect(atEdge.y).toBe(0)
    const mapped = mapCropBoxToPage(
      { page: 2, x: 0.2, y: 0.4, w: 0.5, h: 0.2 },
      { page: 0, x: 0.5, y: 0.5, w: 0.4, h: 0.5 },
    )
    expect(mapped.page).toBe(2)
    expect(mapped.x).toBeCloseTo(0.45)
    expect(mapped.y).toBeCloseTo(0.5)
    expect(mapped.w).toBeCloseTo(0.2)
    expect(mapped.h).toBeCloseTo(0.1)
  })
})
