// =============================================================
// Grading Pipeline 纯函数测试
// 覆盖: isVisionModel / resolveGradingModelIds(显式覆盖+tier 兜底) /
//       buildGradingPrompt(量规注入+JSON 契约) / parseGradeResponse
//       (围栏剥离/前后噪声/钳制/未知题丢弃/同题去重/非法输出拒绝)
// 依赖 mock: settings/keystore/grading-service(pipeline 模块级 import,
//           纯函数不触达,仅保模块可加载)。
// =============================================================

import { beforeAll, describe, expect, it, vi } from 'vitest'

// pipeline → logger → utils/log/state 在模块加载期读 app.getPath('userData')
const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/grading-pipeline-test-${Date.now()}`
      throw new Error(`Unexpected path: ${name}`)
    }),
    completeSimple: vi.fn(),
    // 本文件断言的是 pi 运行时的模型调用（agentRuntime 缺省现已是 dsh）；dsh 见 src/main/services/dsh/__tests__
    getSettings: vi.fn(() => ({ models: { agentRuntime: 'pi' } })),
    resolveModel: vi.fn(),
    gs: {
      getTask: vi.fn(),
      resetPaperForRegrade: vi.fn(),
      setStatus: vi.fn(),
      saveAiResult: vi.fn(),
      applyPaperSnapshot: vi.fn(),
      paperFilePath: vi.fn(),
    },
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
vi.mock('../../src/main/services/pi-ai/model-utils', () => ({
  resolveModel: mocks.resolveModel,
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: () => 'test-key' },
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: mocks.gs,
}))

import {
  buildGradingPrompt,
  fastGradeMaxTokens,
  isGradingParseError,
  isVisionModel,
  parseAnnotationBox,
  parseGradeResponse,
  regradePapers,
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
  it('注入题目 id/题类/满分/评分标准与 JSON 契约', () => {
    const prompt = buildGradingPrompt(RUBRIC)
    expect(prompt).toContain('q-1')
    expect(prompt).toContain('q-2')
    expect(prompt).toContain('30')
    expect(prompt).toContain('BACDA')
    expect(prompt).toContain('"questions"')
    expect(prompt).toContain('只输出')
    // 题类标注: 选择题→客观,解答题→主观(标题关键词推导)
    expect(prompt).toContain('客观')
    expect(prompt).toContain('主观')
  })

  it('红笔痕迹契约: 每题都给 box,comment 仅主观题 30 字以内', () => {
    const prompt = buildGradingPrompt(RUBRIC)
    expect(prompt).toContain('box 每题都要给')
    expect(prompt).toContain('全对的题也要给')
    expect(prompt).toContain('仅主观题')
    expect(prompt).toContain('30 字以内')
    expect(prompt).toContain('客观题(选择/填空/判断)不要写 comment')
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

  it('三档批改口径: 各注入专属规则; 缺省/非法回落正常', () => {
    const strict = buildGradingPrompt(RUBRIC, 'strict')
    expect(strict).toContain('批改口径: 严格模式')
    expect(strict).toContain('步骤缺失/跳步')
    expect(strict).toContain('不做善意解读')

    const lenient = buildGradingPrompt(RUBRIC, 'lenient')
    expect(lenient).toContain('批改口径: 宽松模式')
    expect(lenient).toContain('每处最多扣 1 分')
    expect(lenient).toContain('向有利于学生的方向')

    // 正常为基线: 三种等价写法内容一致
    const normalDefault = buildGradingPrompt(RUBRIC)
    const normalExplicit = buildGradingPrompt(RUBRIC, 'normal')
    const normalFallback = buildGradingPrompt(RUBRIC, 'lazy' as never)
    expect(normalDefault).toBe(normalExplicit)
    expect(normalDefault).toBe(normalFallback)
    expect(normalDefault).toContain('批改口径: 正常模式')
    expect(normalDefault).not.toContain('严格模式')

    // 扣分说明契约在三档下都在
    for (const p of [strict, lenient, normalDefault]) {
      expect(p).toContain('"deductions"')
      expect(p).toContain('凡 score < 满分的题都要给')
    }
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

  it('解析卷面 box 并钳制到 [0,1]', () => {
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":10,"comment":"计算错","box":{"page":0,"x":0.2,"y":1.5,"w":0.3,"h":0.1}}]}',
      RUBRIC,
    )
    expect(r.questions[0]?.box).toEqual({ page: 0, x: 0.2, y: 1, w: 0.3, h: 0.1 })
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

  it('解析 box 并钳制到 [0,1];缺字段则丢弃', () => {
    expect(parseAnnotationBox({ page: 0, x: -0.2, y: 0.5, w: 1.5, h: 0.1 })).toEqual({
      page: 0,
      x: 0,
      y: 0.5,
      w: 1,
      h: 0.1,
    })
    expect(parseAnnotationBox({ page: 0, x: 0.1, y: 0.1, w: 0, h: 0.2 })).toBeUndefined()
    expect(parseAnnotationBox({ page: 1.5, x: 0, y: 0, w: 0.2, h: 0.2 })).toBeUndefined()
    expect(parseAnnotationBox(null)).toBeUndefined()
  })

  it('parseGradeResponse 保留合法 box', () => {
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":10,"box":{"page":0,"x":0.2,"y":0.3,"w":0.4,"h":0.1}}]}',
      RUBRIC,
    )
    expect(r.questions[0]?.box).toEqual({ page: 0, x: 0.2, y: 0.3, w: 0.4, h: 0.1 })
  })

  it('扣分说明 deductions: 合法解析/负数取绝对值/越界钳制/满分题丢弃', () => {
    const r = parseGradeResponse(
      JSON.stringify({
        questions: [
          {
            questionId: 'q-1',
            score: 26,
            deductions: [
              { points: -2, reason: '单位未换算' },
              { points: 1.5, reason: ' 结果计算错误 ' },
              { points: 999, reason: '离谱大扣分' },
              { points: 0, reason: '零分项丢弃' },
              { points: 3, reason: '' },
              'not-an-object',
            ],
          },
          { questionId: 'q-2', score: 20, deductions: [{ points: 1, reason: '满分不应有' }] },
        ],
      }),
      RUBRIC,
    )
    expect(r.questions[0]?.deductions).toEqual([
      { points: 2, reason: '单位未换算' },
      { points: 1.5, reason: '结果计算错误' },
      { points: 30, reason: '离谱大扣分' }, // 钳到该题满分 30
    ])
    // 满分题不保留扣分说明
    expect(r.questions[1]?.deductions).toBeUndefined()
  })

  it('扣分说明: 缺 deductions/非数组 → undefined,不影响得分', () => {
    const r = parseGradeResponse(
      '{"questions":[{"questionId":"q-1","score":10},{"questionId":"q-2","score":3,"deductions":"oops"}]}',
      RUBRIC,
    )
    expect(r.questions[0]?.deductions).toBeUndefined()
    expect(r.questions[1]?.deductions).toBeUndefined()
    expect(r.totalScore).toBe(13)
  })
})

describe('fastGradeMaxTokens — fast 档输出预算自适应', () => {
  it('≤8 题维持 8192;超过 8 题每题 +512', () => {
    expect(fastGradeMaxTokens(8)).toBe(8192)
    expect(fastGradeMaxTokens(9)).toBe(8192 + 512)
    expect(fastGradeMaxTokens(17)).toBe(8192 + 512 * 9) // 12800
  })

  it('>16 题量规预算提升后仍被 model.maxTokens 钳制;未配置上限不钳', () => {
    expect(fastGradeMaxTokens(17, 10000)).toBe(10000)
    expect(fastGradeMaxTokens(17, 20000)).toBe(12800)
    expect(fastGradeMaxTokens(17, undefined)).toBe(12800)
    expect(fastGradeMaxTokens(0)).toBe(8192) // 异常题数按 0 兜底
  })
})

describe('isGradingParseError — 解析类错误分类器(双路重试共用)', () => {
  it('批改/转写/落库校验的解析类消息命中', () => {
    for (const msg of [
      '批改输出不是有效 JSON',
      '批改输出缺少 questions 数组',
      '批改输出没有可识别的题目得分',
      '输出不是 JSON 对象',
      '转写输出没有可用的小题作答',
      '单题批改输出缺少有效 score',
      '分阶段批改没有产出任何题目结果',
      'AI 结果缺少量规题目: q-1、q-2',
      'AI 分数越界 [0, 30]: q-1 = 99',
    ]) {
      expect(isGradingParseError(new Error(msg))).toBe(true)
    }
  })

  it('传输/中止/参数类错误不命中(照常走重试)', () => {
    for (const msg of ['socket hang up', '已中止', '该试卷没有扫描件', 'ETIMEDOUT']) {
      expect(isGradingParseError(new Error(msg))).toBe(false)
    }
    expect(isGradingParseError(undefined)).toBe(false)
    expect(isGradingParseError('裸字符串: 批改输出不是有效 JSON')).toBe(true) // 字符串错误也认
  })
})

describe('regradePapers — 外层重试收敛(解析类不整体重试)', () => {
  const tmpDir = `${process.env.TEMP || process.env.TMP || '/tmp'}/regrade-it-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fakeModel = {
    provider: 'prov-a',
    id: 'model-a',
    input: ['image'],
    maxTokens: 8192,
  } as never

  const okJson =
    '{"questions":[{"questionId":"q-1","score":5,"box":{"page":0,"x":0.1,"y":0.1,"w":0.5,"h":0.2}},{"questionId":"q-2","score":7}]}'
  const textResult = (text: string) => ({
    stopReason: 'stop',
    content: [{ type: 'text', text }],
    usage: { input: 10, output: 10 },
  })

  beforeAll(async () => {
    const fsp = await import('node:fs/promises')
    const { join } = await import('node:path')
    await fsp.mkdir(tmpDir, { recursive: true })
    await fsp.writeFile(join(tmpDir, 'p1.jpg'), Buffer.from('fake-jpeg'))
    mocks.gs.paperFilePath.mockImplementation((_t: string, stored: string) => join(tmpDir, stored))
    mocks.getSettings.mockImplementation(() => ({
      grading: { provider: 'prov-a', model: 'model-a' },
      // 覆盖 mock 也要带上后端：本组用例断言 pi 的 completeSimple 调用次数
      models: { agentRuntime: 'pi' },
    }))
    mocks.resolveModel.mockImplementation(() => fakeModel)
  })

  const mkTask = () => ({
    id: 't-1',
    name: '重改测试',
    semester: '2026 上',
    status: 'review' as const,
    gradingStrategy: 'fast' as const,
    rubric: RUBRIC,
    papers: [
      {
        id: 'p-1',
        studentName: '张三',
        files: [{ name: 'p1.jpg', storedName: 'p1.jpg', mime: 'image/jpeg', bytes: 12 }],
        uploadedAt: '2026-01-01T00:00:00Z',
        status: 'graded' as const,
        ai: {
          questions: [
            { questionId: 'q-1', score: 1 },
            { questionId: 'q-2', score: 1 },
          ],
          totalScore: 2,
          model: { provider: 'prov-a', model: 'model-a' },
          finishedAt: '2026-01-01T00:00:00Z',
        },
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })

  beforeEach(() => {
    mocks.completeSimple.mockReset()
    mocks.gs.getTask.mockReset().mockImplementation(async () => mkTask())
    mocks.gs.resetPaperForRegrade.mockReset().mockResolvedValue(undefined)
    mocks.gs.setStatus.mockReset().mockResolvedValue(undefined)
    mocks.gs.saveAiResult.mockReset().mockResolvedValue(undefined)
    mocks.gs.applyPaperSnapshot.mockReset().mockResolvedValue(undefined)
  })

  it('坏 JSON 输入: 外层总调用 1 次非 2 次,标 failed 并回滚', async () => {
    mocks.completeSimple.mockResolvedValue(textResult('根本不是 JSON 的散文'))
    await regradePapers('t-1', ['p-1'], null)
    await vi.waitFor(() => expect(mocks.gs.setStatus).toHaveBeenCalledWith('t-1', 'review'))
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1) // 解析类不再消耗外层第二次
    expect(mocks.gs.saveAiResult).not.toHaveBeenCalled()
    expect(mocks.gs.applyPaperSnapshot).toHaveBeenCalledWith('t-1', 'p-1', expect.anything())
  })

  it('传输类瞬时错误: 外层仍重试,第二次成功落库', async () => {
    mocks.completeSimple
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(textResult(okJson))
    await regradePapers('t-1', ['p-1'], null)
    await vi.waitFor(() => expect(mocks.gs.setStatus).toHaveBeenCalledWith('t-1', 'review'))
    expect(mocks.completeSimple).toHaveBeenCalledTimes(2)
    expect(mocks.gs.saveAiResult).toHaveBeenCalledTimes(1)
  })
})
