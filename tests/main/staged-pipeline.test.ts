// =============================================================
// Staged Pipeline 纯函数测试
// 覆盖: planStagedBatches(题型排序+转写判定) / parseReferenceAnswers(四种形态
//       +混排合并+expectedSubCount 分层收紧) / expectedSubCountOf
//       / parseTranscribeResponse / perSubQuestionMark / ruleScoreQuestion
//       / parseStagedGradeResponse / parseLocateResponse / expandBox
//       / mapCropBoxToPage / pickMedianSample(取中位+box 映射基准)
// 依赖 mock: 与 grading-pipeline.test.ts 同套(模块级 import 保可加载)。
// =============================================================

import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/staged-pipeline-test-${Date.now()}`
      throw new Error(`Unexpected path: ${name}`)
    }),
    completeSimple: vi.fn(),
    paperFilePath: vi.fn(),
  }
})
vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))

vi.mock('@earendil-works/pi-ai/compat', () => ({
  completeSimple: mocks.completeSimple,
  getEnvApiKey: () => undefined,
}))
vi.mock('@earendil-works/pi-ai', () => ({
  parseJsonWithRepair: (s: string) => JSON.parse(s),
}))
// 裁剪走真实 canvas 会解码图片: 测试里统一抛错 → cropPaperImage 回落整页
vi.mock('@napi-rs/canvas', () => ({
  loadImage: async () => {
    throw new Error('skip crop in test')
  },
  createCanvas: () => {
    throw new Error('skip crop in test')
  },
}))

// 本文件断言的是 pi 运行时的模型调用计数（agentRuntime 缺省现已是 dsh）；dsh 见 src/main/services/dsh/__tests__
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => ({ models: { agentRuntime: 'pi' } }) },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: () => undefined },
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: { paperFilePath: mocks.paperFilePath },
}))

import {
  buildStagedGradePrompt,
  expectedSubCountOf,
  expandBox,
  gradePaperStaged,
  isRuleScoreable,
  mapCropBoxToPage,
  normalizeObjectiveValue,
  parseLocateResponse,
  parseReferenceAnswers,
  parseStagedGradeResponse,
  parseTranscribeResponse,
  perSubQuestionMark,
  pickMedianSample,
  planStagedBatches,
  ruleScoreQuestion,
  type StagedSharedContext,
} from '../../src/main/services/grading/staged-pipeline'
import { gradePaperByStrategy } from '../../src/main/services/grading/grading-pipeline'

import type { Api, Model } from '@earendil-works/pi-ai/compat'
import fsp from 'node:fs/promises'
import { join } from 'node:path'
import type { GradingPaper, GradingTask, RubricQuestion } from '@shared/types'

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

describe('parseReferenceAnswers — 混排形态合并', () => {
  it('逐题对 + 区段 两轮合并: "1.B 2.A 3.C 4.D 5.B 6-10 CCDAB" 解析出全部 10 小题', () => {
    const ref = parseReferenceAnswers('1.B 2.A 3.C 4.D 5.B 6-10 CCDAB')
    expect(ref?.size).toBe(10)
    expect(ref?.get(1)).toBe('B')
    expect(ref?.get(5)).toBe('B')
    expect(ref?.get(6)).toBe('C')
    expect(ref?.get(10)).toBe('B')
  })

  it('区段 + 逐题对 反向混排: "1-5 BACDA 6.B 7.C" 合并出 1-7', () => {
    const ref = parseReferenceAnswers('1-5 BACDA 6.B 7.C')
    expect(ref?.size).toBe(7)
    expect(ref?.get(1)).toBe('B')
    expect(ref?.get(5)).toBe('A')
    expect(ref?.get(6)).toBe('B')
    expect(ref?.get(7)).toBe('C')
  })

  it('半坏区段(长度不符)被跳过: 单参调用返回已解析的 1-5 共 5 项,不得 null', () => {
    const ref = parseReferenceAnswers('1-5 BACDA 6-10 CCDB')
    expect(ref?.size).toBe(5)
    expect(ref?.get(5)).toBe('A')
    expect(ref?.has(6)).toBe(false)
  })

  it('混并后题号冲突 → null;裸序列带分隔符 "AC BD" 仍解析成 4 项', () => {
    expect(parseReferenceAnswers('1-5 BACDA 1.C')).toBeNull()
    const spaced = parseReferenceAnswers('AC BD')
    expect(spaced?.size).toBe(4)
    expect(spaced?.get(1)).toBe('A')
    expect(spaced?.get(4)).toBe('D')
  })
})

describe('parseReferenceAnswers + expectedSubCount 分层收紧', () => {
  it('裸序列: 长度等于期望才接受 — "BACDA" 传 5 通过、传 10 → null', () => {
    expect(parseReferenceAnswers('BACDA', 5)?.size).toBe(5)
    expect(parseReferenceAnswers('BACDA', 10)).toBeNull()
  })

  it('部分解析(半坏区段)条目数不符期望 → null;合并后条目数等于期望 → 通过', () => {
    expect(parseReferenceAnswers('1-5 BACDA 6-10 CCDB', 10)).toBeNull()
    expect(parseReferenceAnswers('1-5 BACDA 6.B 7.C', 7)?.size).toBe(7)
  })

  it('isRuleScoreable: 题名推导出期望后,半坏/长度不符的参考答案被拦截(拦截打在期望小题数层)', () => {
    // 单参解析本身非 null(各得 5 项/4 项),收紧只发生在带期望的第二参上
    expect(parseReferenceAnswers('1-5 BACDA 6-10 CCDB')?.size).toBe(5)
    expect(parseReferenceAnswers('AC BD')?.size).toBe(4)
    const title = '一、单选题（每小题5分，共10小题）'
    expect(
      isRuleScoreable(q({ id: 'a', title, fullMark: 50, referenceAnswer: '1-5 BACDA 6-10 CCDB' })),
    ).toBe(false)
    expect(isRuleScoreable(q({ id: 'b', title, fullMark: 50, referenceAnswer: 'AC BD' }))).toBe(
      false,
    )
  })

  it('isRuleScoreable: 推导不出期望(undefined) → 行为与现状一致,裸序列照旧接受', () => {
    expect(isRuleScoreable(q({ id: 'a', title: '判断题', referenceAnswer: '√×√√' }))).toBe(true)
    expect(
      isRuleScoreable(q({ id: 'b', title: '一、单选题', referenceAnswer: '1-5 BACDA 6-10 CCDB' })),
    ).toBe(true)
  })
})

describe('expectedSubCountOf — 题名推导期望小题数', () => {
  it('「共 N 小题」优先;「每小题 X 分」按 round(满分/X);推导不出 → undefined', () => {
    expect(expectedSubCountOf(q({ id: 'a', title: '每小题5分，共10小题', fullMark: 50 }))).toBe(10)
    expect(expectedSubCountOf(q({ id: 'b', title: '一、单选题（共12小题）', fullMark: 60 }))).toBe(12)
    expect(expectedSubCountOf(q({ id: 'c', title: '一、单选题（每小题3分）', fullMark: 30 }))).toBe(10)
    expect(expectedSubCountOf(q({ id: 'd', title: '判断题' }))).toBeUndefined()
    expect(expectedSubCountOf(q({ id: 'e', title: '每小题0分，共10小题', fullMark: 0 }))).toBe(10)
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

describe('pickMedianSample — 多采样取中位挑选(贴边界复验)', () => {
  it('三样本分数各异: 中位落在第二/第三采样 → 输出取该样本', () => {
    const a = { score: 10, tag: 'a' }
    const b = { score: 6, tag: 'b' }
    const c = { score: 2, tag: 'c' }
    expect(pickMedianSample([a, b, c], 1)?.tag).toBe('b') // 中位=第二采样
    expect(pickMedianSample([a, c, b], 1)?.tag).toBe('b') // 同组分数,中位样本原序在后
    const x = { score: 0, tag: 'x' }
    const y = { score: 9, tag: 'y' }
    const z = { score: 5, tag: 'z' }
    expect(pickMedianSample([x, y, z], 1)?.tag).toBe('z') // 中位=第三采样
  })

  it('分差 ≤ tolerance 视为一致 → 返回首采;空入参 → null;单样本透传', () => {
    const a = { score: 10, tag: 'a' }
    expect(pickMedianSample([a, { score: 10.5, tag: 'b' }, { score: 9.8, tag: 'c' }], 1)).toBe(a)
    expect(pickMedianSample([], 1)).toBeNull()
    expect(pickMedianSample([a], 1)).toBe(a)
  })

  it('被选样本以自身裁剪图 box 为基准,经 mapCropBoxToPage 单次映射为整页口径', () => {
    const samples = [
      { score: 0, box: { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { score: 9, box: { page: 0, x: 0.4, y: 0.4, w: 0.2, h: 0.2 } },
      { score: 5, box: { page: 0, x: 0.5, y: 0.5, w: 0.4, h: 0.4 } },
    ]
    const picked = pickMedianSample(samples, 1)
    expect(picked?.box.x).toBeCloseTo(0.5) // 取的是第三采样自身的 box
    const mapped = picked ? mapCropBoxToPage({ page: 1, x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, picked.box) : null
    expect(mapped?.page).toBe(1)
    expect(mapped?.x).toBeCloseTo(0.45)
    expect(mapped?.w).toBeCloseTo(0.2)
  })
})

describe('perSubQuestionMark 除法分支舍入残差', () => {
  const div = q({ id: 'q-div', title: '一、单选题', fullMark: 10 })
  const ref3 = parseReferenceAnswers('ABC') as Map<number, string>
  const answers = (errors: number) =>
    [1, 2, 3].map((no) => ({
      no,
      value: no <= errors ? 'D' : (ref3.get(no) as string),
      uncertain: false,
    }))

  it('除法分支: fullMark=10、3 小题全错 → 0(不再得 0.01);错 1 → 6.67', () => {
    expect(ruleScoreQuestion(div, ref3, answers(3)).result.score).toBe(0)
    expect(ruleScoreQuestion(div, ref3, answers(1)).result.score).toBe(6.67)
  })

  it('除法分支每小题分值返回精确值;扣分项展示 round 到 2 位', () => {
    expect(perSubQuestionMark(div, 3)).toBe(10 / 3)
    const outcome = ruleScoreQuestion(div, ref3, answers(1))
    expect(outcome.result.deductions?.[0]?.points).toBe(3.33)
  })

  it('评分点分支口径锁定: fullMark=10、3 小题、「第1小题 3 分」→ 错 1 = 7、全错 = 1(不改为比例口径)', () => {
    const preset = q({
      id: 'q-pre',
      title: '一、单选题',
      fullMark: 10,
      presetMarks: [{ points: 3, note: '第1小题 3 分' }],
    })
    expect(ruleScoreQuestion(preset, ref3, answers(1)).result.score).toBe(7)
    expect(ruleScoreQuestion(preset, ref3, answers(3)).result.score).toBe(1)
  })
})

// =============================================================
// gradePaperStaged / gradePaperByStrategy 集成(fake model 调用计数)
// 覆盖: locate 母版模板复用 / dual 共享 locate+页缓存 / withRetry 解析类
//       不重试 / 转写复验后仍 uncertain 与三采取中位的 confidence 标注
// =============================================================

const STAGED_RUBRIC = [
  q({ id: 'q-1', title: '一、单选题（每小题2分，共2小题）', fullMark: 4, referenceAnswer: 'BA' }),
  q({ id: 'q-2', title: '三、计算题', fullMark: 10 }),
]

const fakeModel = {
  provider: 'prov-a',
  id: 'model-a',
  input: ['image'],
  maxTokens: 8192,
} as unknown as Model<Api>

const fakeModel2 = { ...fakeModel, provider: 'prov-b', id: 'model-b' } as unknown as Model<Api>

const textResult = (text: string) => ({
  stopReason: 'stop' as const,
  content: [{ type: 'text' as const, text }],
  usage: { input: 10, output: 10 },
})

/** 按调用序分派的 fake completeSimple 实现(默认: 全部正常返回) */
function defaultDispatch(
  _model: unknown,
  req: { systemPrompt?: string; messages?: Array<{ content?: Array<{ type: string; text?: string }> }> },
): ReturnType<typeof textResult> {
  const sys = req.systemPrompt ?? ''
  if (sys.includes('版面定位')) {
    return textResult(
      '{"boxes":[{"questionId":"q-1","page":0,"x":0.05,"y":0.05,"w":0.9,"h":0.2},{"questionId":"q-2","page":0,"x":0.05,"y":0.4,"w":0.9,"h":0.5}]}',
    )
  }
  if (sys.includes('只认读')) {
    return textResult('{"answers":[{"no":1,"value":"B"},{"no":2,"value":"A"}]}')
  }
  return textResult('{"score":7,"evidence":"依据：过程基本正确"}')
}

function sysPromptOf(req: unknown): string {
  return ((req as { systemPrompt?: string }).systemPrompt ?? '')
}

describe('gradePaperStaged 集成 — locate 模板复用(fake model 计数)', () => {
  const tmpDir = `${process.env.TEMP || process.env.TMP || '/tmp'}/staged-it-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const paperFile = (storedName: string) => ({
    name: storedName,
    storedName,
    mime: 'image/jpeg',
    bytes: 16,
  })

  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
    await fsp.writeFile(join(tmpDir, 'p1.jpg'), Buffer.from('fake-jpeg-bytes'))
    await fsp.writeFile(join(tmpDir, 'p1b.jpg'), Buffer.from('fake-jpeg-bytes-2'))
    await fsp.writeFile(join(tmpDir, 'tpl-0.jpg'), Buffer.from('fake-template-page'))
    mocks.paperFilePath.mockImplementation((_taskId: string, stored: string) =>
      join(tmpDir, stored),
    )
  })

  const mkTask = (paperFiles: number, overlayTemplate?: GradingTask['overlayTemplate']) =>
    ({
      id: 'task-1',
      name: '测试任务',
      semester: '2026 上',
      status: 'review',
      rubric: STAGED_RUBRIC,
      papers: [
        {
          id: 'p-1',
          studentName: '张三',
          files: [paperFile('p1.jpg'), paperFile('p1b.jpg'), paperFile('tpl-0.jpg')].slice(
            0,
            paperFiles,
          ),
          uploadedAt: '2026-01-01T00:00:00Z',
          status: 'pending',
        } satisfies GradingPaper,
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...(overlayTemplate ? { overlayTemplate } : {}),
    }) as GradingTask

  const runStaged = (task: GradingTask, shared?: StagedSharedContext) =>
    gradePaperStaged({
      task,
      paperId: 'p-1',
      model: fakeModel,
      apiKey: 'k',
      signal: new AbortController().signal,
      selfVerify: false,
      shared,
    })

  it('overlayTemplate.boxes 覆盖全部量规题且卷页数==标定页数 → 不发 locate,结果用模板坐标', async () => {
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation(defaultDispatch)
    const task = mkTask(1, {
      files: [paperFile('tpl-0.jpg')],
      boxes: {
        'q-1': { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
        'q-2': { page: 0, x: 0.1, y: 0.5, w: 0.5, h: 0.3 },
      },
      calibratedAt: '2026-01-01T00:00:00Z',
    })
    const result = await runStaged(task)
    const locateCalls = mocks.completeSimple.mock.calls.filter(([ , req]) =>
      sysPromptOf(req).includes('版面定位'),
    )
    expect(locateCalls).toHaveLength(0) // 每卷省一次全页图输入
    // 批调用照常: 1 转写 + 1 聚焦批改
    expect(mocks.completeSimple).toHaveBeenCalledTimes(2)
    // 转写题 box 直接透传模板坐标
    expect(result.questions.find((x) => x.questionId === 'q-1')?.box).toEqual({
      page: 0,
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.2,
    })
  })

  it('卷页数与标定页数不一致 → 回落逐卷 locate 照发', async () => {
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation(defaultDispatch)
    const task = mkTask(2, {
      files: [paperFile('tpl-0.jpg')], // 标定 1 页,本卷 2 页
      boxes: {
        'q-1': { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
        'q-2': { page: 0, x: 0.1, y: 0.5, w: 0.5, h: 0.3 },
      },
      calibratedAt: '2026-01-01T00:00:00Z',
    })
    await runStaged(task)
    const locateCalls = mocks.completeSimple.mock.calls.filter(([ , req]) =>
      sysPromptOf(req).includes('版面定位'),
    )
    expect(locateCalls).toHaveLength(1)
  })

  it('模板 boxes 缺一题(未覆盖全部量规题) → 同样回落逐卷 locate', async () => {
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation(defaultDispatch)
    const task = mkTask(1, {
      files: [paperFile('tpl-0.jpg')],
      boxes: { 'q-1': { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.2 } }, // 缺 q-2
      calibratedAt: '2026-01-01T00:00:00Z',
    })
    await runStaged(task)
    const locateCalls = mocks.completeSimple.mock.calls.filter(([ , req]) =>
      sysPromptOf(req).includes('版面定位'),
    )
    expect(locateCalls).toHaveLength(1)
  })

  it('dual 分支(gradePaperByStrategy): 两模型共享一次 locate + 页缓存,批调用各自独立不减少', async () => {
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation(defaultDispatch)
    mocks.paperFilePath.mockClear()
    const task = { ...mkTask(1), gradingStrategy: 'dual' as const }
    const outcome = await gradePaperByStrategy(
      task,
      'p-1',
      fakeModel,
      fakeModel2,
      'k',
      'k2',
      new AbortController().signal,
    )
    const locateCalls = mocks.completeSimple.mock.calls.filter(([ , req]) =>
      sysPromptOf(req).includes('版面定位'),
    )
    expect(locateCalls).toHaveLength(1) // 只定位一次(第一模型产出,第二模型复用)
    expect(mocks.paperFilePath).toHaveBeenCalledTimes(1) // 页缓存: 1 页只读一次盘
    // 批调用独立计数不减少: 每模型 1 转写 + 1 批改
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1 + 2 + 2)
    expect(outcome.result.questions).toHaveLength(2)
    expect(outcome.disputes ?? []).toHaveLength(0) // fake 两模型同分 → 无分歧
  })

  it('dual 直连 gradePaperStaged: shared 上下文二次调用不发 locate、不读盘', async () => {
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation(defaultDispatch)
    mocks.paperFilePath.mockClear()
    const task = mkTask(1)
    const shared: StagedSharedContext = {}
    await runStaged(task, shared)
    await gradePaperStaged({
      task,
      paperId: 'p-1',
      model: fakeModel2,
      apiKey: 'k2',
      signal: new AbortController().signal,
      selfVerify: false,
      shared,
    })
    const locateCalls = mocks.completeSimple.mock.calls.filter(([ , req]) =>
      sysPromptOf(req).includes('版面定位'),
    )
    expect(locateCalls).toHaveLength(1)
    expect(mocks.paperFilePath).toHaveBeenCalledTimes(1)
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1 + 2 + 2)
  })

  it('withRetry: 解析类错误(坏 JSON)只调 1 次不重试,直接上抛', async () => {
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation((...args: Parameters<typeof defaultDispatch>) => {
      const sys = sysPromptOf(args[1])
      if (sys.includes('阅卷教师')) return textResult('这根本不是 JSON 的散文输出')
      return defaultDispatch(...args)
    })
    const task = mkTask(1)
    await expect(runStaged(task)).rejects.toThrow('输出不是 JSON 对象')
    const gradeCalls = mocks.completeSimple.mock.calls.filter(([ , req]) =>
      sysPromptOf(req).includes('阅卷教师'),
    )
    expect(gradeCalls).toHaveLength(1) // 非 2: 解析类不再消耗重试
  })

  it('withRetry: 传输类瞬时错误仍重试一次后成功', async () => {
    let gradeCalls = 0
    mocks.completeSimple.mockReset()
    mocks.completeSimple.mockImplementation((...args: Parameters<typeof defaultDispatch>) => {
      const sys = sysPromptOf(args[1])
      if (sys.includes('阅卷教师')) {
        gradeCalls += 1
        if (gradeCalls === 1) throw new Error('socket hang up')
        return textResult('{"score":7,"evidence":"ok"}')
      }
      return defaultDispatch(...args)
    })
    const task = mkTask(1)
    const result = await runStaged(task)
    expect(gradeCalls).toBe(2)
    expect(result.questions.find((x) => x.questionId === 'q-2')?.score).toBe(7)
  })

  it('置信度: 转写复验后仍 uncertain 的题 confidence=medium;主观题三采取中位也标 medium', async () => {
    mocks.completeSimple.mockReset()
    let transcribeCalls = 0
    let gradeCalls = 0
    const gradeScores = [10, 3, 6] // 首采 10(满分) → 二采 3(分歧超阈值) → 三采 6 → 中位
    mocks.completeSimple.mockImplementation((...args: Parameters<typeof defaultDispatch>) => {
      const sys = sysPromptOf(args[1])
      if (sys.includes('只认读')) {
        transcribeCalls += 1
        // 首读与复读都给第 2 小题 uncertain 且读错 → 复验后仍 uncertain
        return textResult('{"answers":[{"no":1,"value":"B"},{"no":2,"value":"C","uncertain":true}]}')
      }
      if (sys.includes('阅卷教师')) {
        const score = gradeScores[gradeCalls] ?? 6
        gradeCalls += 1
        return textResult(`{"score":${score},"evidence":"采分 ${score}"}`)
      }
      return defaultDispatch(...args)
    })
    const task = mkTask(1)
    const result = await gradePaperStaged({
      task,
      paperId: 'p-1',
      model: fakeModel,
      apiKey: 'k',
      signal: new AbortController().signal,
      selfVerify: true, // 开条件复验
    })
    expect(transcribeCalls).toBe(2) // 首读 + 复读一次
    const t1 = result.questions.find((x) => x.questionId === 'q-1')
    expect(t1?.confidence).toBe('medium') // 复验后仍 uncertain
    expect(t1?.score).toBe(2) // 判分照旧: 第 2 小题错(读 C 应 A)
    const t2 = result.questions.find((x) => x.questionId === 'q-2')
    expect(t2?.score).toBe(6) // 三采取中位
    expect(t2?.confidence).toBe('medium')
    expect(t2?.evidence).toContain('复验取中位')
  })
})
