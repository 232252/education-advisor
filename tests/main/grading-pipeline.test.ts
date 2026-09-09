// =============================================================
// Grading Pipeline 纯函数测试
// 覆盖: isVisionModel / resolveGradingModelIds(显式覆盖+tier 兜底) /
//       buildGradingPrompt(量规注入+JSON 契约) / parseGradeResponse
//       (围栏剥离/前后噪声/钳制/未知题丢弃/同题去重/非法输出拒绝)
// 依赖 mock: settings/keystore/grading-service(pipeline 模块级 import,
//           纯函数不触达,仅保模块可加载)。
// =============================================================

import { describe, expect, it, vi } from 'vitest'

// pipeline → logger → utils/log/state 在模块加载期读 app.getPath('userData')
const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/grading-pipeline-test-${Date.now()}`
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
  buildGradingPrompt,
  isVisionModel,
  parseGradeResponse,
  resolveGradingModelIds,
} from '../../src/main/services/grading/grading-pipeline'

const RUBRIC = [
  { id: 'q-1', title: '选择题', fullMark: 30, order: 1, referenceAnswer: '1-5 BACDA' },
  { id: 'q-2', title: '解答题', fullMark: 20, order: 2 },
]

describe('isVisionModel', () => {
  it('input 含 image 才是视觉模型', () => {
    expect(isVisionModel({ input: ['text', 'image'] } as never)).toBe(true)
    expect(isVisionModel({ input: ['text'] } as never)).toBe(false)
    expect(isVisionModel({} as never)).toBe(false)
  })
})

describe('resolveGradingModelIds', () => {
  it('显式配置优先', () => {
    const ids = resolveGradingModelIds({
      grading: { provider: 'anthropic', model: 'claude-sonnet-4' },
      models: { defaultProvider: 'openai', highQualityModel: 'gpt-5', defaultModel: '', lowCostModel: '', enabledModels: [], transport: 'auto', cacheRetention: 'none', retry: { enabled: true, maxRetries: 3, baseDelayMs: 1, providerTimeoutMs: 1 }, providerBlacklist: [], customModels: {} },
    } as never)
    expect(ids).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4' })
  })

  it('未配置时跟随 高质量模型 → 默认模型', () => {
    const base = { grading: { provider: '', model: '' } }
    const hq = resolveGradingModelIds({
      ...base,
      models: { defaultProvider: 'openai', highQualityModel: 'gpt-5', defaultModel: 'gpt-4o-mini' },
    } as never)
    expect(hq).toEqual({ providerId: 'openai', modelId: 'gpt-5' })
    const fallback = resolveGradingModelIds({
      ...base,
      models: { defaultProvider: 'openai', highQualityModel: '', defaultModel: 'gpt-4o-mini' },
    } as never)
    expect(fallback).toEqual({ providerId: 'openai', modelId: 'gpt-4o-mini' })
  })
})

describe('buildGradingPrompt', () => {
  it('注入题目 id/满分/评分标准与 JSON 契约', () => {
    const prompt = buildGradingPrompt(RUBRIC)
    expect(prompt).toContain('q-1')
    expect(prompt).toContain('q-2')
    expect(prompt).toContain('30')
    expect(prompt).toContain('BACDA')
    expect(prompt).toContain('"questions"')
    expect(prompt).toContain('只输出')
  })

  it('有评分点时注入 marks 契约并从满分加减', () => {
    const prompt = buildGradingPrompt([
      {
        id: 'q-1',
        title: '解答题',
        fullMark: 10,
        order: 1,
        presetMarks: [
          { points: -2, note: '漏写单位' },
          { points: -5, note: '公式错误' },
        ],
      },
    ])
    expect(prompt).toContain('漏写单位')
    expect(prompt).toContain('[0]')
    expect(prompt).toContain('"marks"')
    expect(prompt).toContain('满分+所选评分点')
  })
})

describe('parseGradeResponse', () => {
  it('标准 JSON 解析并求和', () => {
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":28,"evidence":"第4题错"},{"questionId":"q-2","score":15}]}',
      RUBRIC,
    )
    expect(r.questions).toHaveLength(2)
    expect(r.totalScore).toBe(43)
    expect(r.questions[0]?.evidence).toBe('第4题错')
  })

  it('剥离 markdown 围栏与前后噪声', () => {
    const r = parseGradeResponse(
      '好的，以下是批改结果：\n```json\n{"questions":[{"questionId":"q-1","score":25},{"questionId":"q-2","score":18}]}\n```\n以上。',
      RUBRIC,
    )
    expect(r.totalScore).toBe(43)
  })

  it('越界分数钳制到 [0, 满分]; 未知题目丢弃', () => {
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":999},{"questionId":"q-2","score":-5},{"questionId":"q-404","score":1}]}',
      RUBRIC,
    )
    expect(r.questions.map((q) => q.questionId)).toEqual(['q-1', 'q-2'])
    expect(r.questions[0]?.score).toBe(30)
    expect(r.questions[1]?.score).toBe(0)
    expect(r.totalScore).toBe(30)
  })

  it('同题多次出现以最后一次为准', () => {
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":10},{"questionId":"q-1","score":20}]}',
      RUBRIC,
    )
    expect(r.questions).toHaveLength(1)
    expect(r.totalScore).toBe(20)
  })

  it('缺 questions 数组 / 全部无效 → 抛错', () => {
    expect(() => parseGradeResponse('{"foo":1}', RUBRIC)).toThrow('questions')
    expect(() => parseGradeResponse('{"questions":[{"questionId":"q-x","score":1}]}', RUBRIC)).toThrow()
    expect(() => parseGradeResponse('完全不是 JSON 的输出', RUBRIC)).toThrow()
  })

  it('评分点 marks 覆盖 score(从满分加减)', () => {
    const rubric = [
      {
        id: 'q-1',
        title: '解答',
        fullMark: 10,
        order: 1,
        presetMarks: [
          { points: -2, note: '漏单位' },
          { points: -5, note: '公式错' },
        ],
      },
    ]
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":99,"marks":[0,1]}]}',
      rubric,
    )
    expect(r.questions[0]?.score).toBe(3)
    expect(r.questions[0]?.appliedMarks).toEqual([0, 1])
  })
})
