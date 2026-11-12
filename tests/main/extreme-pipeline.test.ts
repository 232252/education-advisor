// =============================================================
// 极致 AI 模式管线:提示词契约 / 200K 压缩 / 双核验给分 / 重裁+仲裁
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/extreme-pipeline-test-${Date.now()}`
      throw new Error(`Unexpected path: ${name}`)
    }),
    complete: vi.fn(),
    gs: { paperFilePath: vi.fn() },
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))
vi.mock('@earendil-works/pi-ai/compat', () => ({
  completeSimple: vi.fn(),
  getEnvApiKey: () => undefined,
}))
vi.mock('../../src/main/services/grading/llm-call', () => ({
  completeGradingCall: (...args: unknown[]) => mocks.complete(...args),
  resetGradingDshRuntime: () => {},
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => ({ models: { agentRuntime: 'dsh' } }) },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: () => 'test-key' },
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: mocks.gs,
}))
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
}))

import type { Api, Model } from '../../src/main/services/llm-contracts'
import {
  applyExtremeContextBudget,
  bothVerificationsPassed,
  buildExtremeArbitratePrompt,
  buildExtremeGradePrompt,
  buildExtremeRegradePrompt,
  buildExtremeVerifyPrompt,
  estimateExtremeTokens,
  EXTREME_CONTEXT_WINDOW,
  gradePaperExtreme,
  parseVerificationResponse,
} from '../../src/main/services/grading/extreme-pipeline'
import type { GradingTask, RubricQuestion } from '../../src/shared/types'

const RUBRIC: RubricQuestion[] = [
  { id: 'q-1', title: '选择题', fullMark: 10, order: 1, referenceAnswer: 'A' },
  { id: 'q-2', title: '解答题', fullMark: 20, order: 2, referenceAnswer: '步骤完整给分' },
]

function assistant(text: string, input = 100, output = 50) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    stopReason: 'stop' as const,
    usage: { input, output, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
    api: 'anthropic-messages',
    provider: 'test-provider',
    model: 'vision-1',
  }
}

function gradeJson(scores: Record<string, number>): string {
  return JSON.stringify({
    questions: Object.entries(scores).map(([questionId, score]) => ({
      questionId,
      score,
      evidence: '卷面可见作答',
      comment: questionId === 'q-2' ? '步骤完整' : undefined,
      deductions: score < (questionId === 'q-1' ? 10 : 20) ? [{ points: 2, reason: '小瑕疵' }] : undefined,
      box: { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    })),
  })
}

const MODEL = {
  id: 'vision-1',
  provider: 'test-provider',
  api: 'anthropic-messages',
  maxTokens: 8192,
  contextWindow: 1_000_000,
  input: ['text', 'image'],
} as unknown as Model<Api>

function makeTask(strategy: GradingTask['gradingStrategy'] = 'extreme'): GradingTask {
  return {
    id: 'task-1',
    name: '期中',
    semester: '2026-春',
    status: 'grading',
    gradingStrategy: strategy,
    gradingMode: 'normal',
    rubric: RUBRIC,
    papers: [
      {
        id: 'paper-1',
        studentName: '张三',
        files: [{ name: 'p1.jpg', storedName: 'p1.jpg', mime: 'image/jpeg', bytes: 10 }],
        uploadedAt: '2026-11-12T00:00:00.000Z',
        status: 'pending',
      },
    ],
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  }
}

const FAKE_IMAGES = [{ type: 'image' as const, data: 'aaaa', mimeType: 'image/jpeg' }]

describe('极致 AI 提示词契约', () => {
  it('初评提示词要求纯视觉批改、双子核验、打印痕迹与 JSON', () => {
    const p = buildExtremeGradePrompt(RUBRIC, 'normal')
    expect(p).toContain('视觉')
    expect(p).toContain('两个子代理')
    expect(p).toContain('核验')
    expect(p).toContain('重裁')
    expect(p).toContain('仲裁')
    expect(p).toMatch(/打印|红笔|PDF/)
    expect(p).toContain('q-1')
    expect(p).toContain('只输出一个 JSON')
  })

  it('两个核验子代理提示词彼此区分且只核验不给分', () => {
    const a = buildExtremeVerifyPrompt(1, RUBRIC)
    const b = buildExtremeVerifyPrompt(2, RUBRIC)
    expect(a).toContain('第 1 个')
    expect(b).toContain('第 2 个')
    expect(a).toContain('对齐核验')
    expect(a).toContain('不要输出 questions')
    expect(a).toContain('passed')
  })

  it('重裁与仲裁提示词包含核验意见与最终给分契约', () => {
    const r = buildExtremeRegradePrompt(RUBRIC, 'normal', [{ questionId: 'q-2', reason: '分数偏高' }])
    expect(r).toContain('重裁')
    expect(r).toContain('分数偏高')
    const a = buildExtremeArbitratePrompt(RUBRIC, 'strict')
    expect(a).toContain('仲裁子代理')
    expect(a).toContain('最终')
    expect(a).toContain('打印 PDF')
  })
})

describe('parseVerificationResponse / bothVerificationsPassed', () => {
  it('明确 passed=true 且无 issues 才算通过', () => {
    expect(parseVerificationResponse('{"passed":true,"summary":"对齐","issues":[]}').passed).toBe(true)
    expect(parseVerificationResponse('{"passed":false,"issues":[{"questionId":"q-1","reason":"多给了分"}]}').passed).toBe(
      false,
    )
  })

  it('passed=true 但仍列出 issues 视为不通过;非法 JSON 视为不通过', () => {
    expect(
      parseVerificationResponse('{"passed":true,"issues":[{"questionId":"q-1","reason":"存疑"}]}').passed,
    ).toBe(false)
    expect(parseVerificationResponse('这不是 JSON').passed).toBe(false)
  })

  it('剥离 markdown 围栏', () => {
    expect(parseVerificationResponse('```json\n{"passed":true,"issues":[]}\n```').passed).toBe(true)
  })

  it('两个都通过才算完全通过', () => {
    const ok = { passed: true, issues: [] }
    const no = { passed: false, issues: [{ reason: 'x' }] }
    expect(bothVerificationsPassed(ok, ok)).toBe(true)
    expect(bothVerificationsPassed(ok, no)).toBe(false)
    expect(bothVerificationsPassed(no, no)).toBe(false)
  })
})

describe('200K 自动压缩', () => {
  it('窗口常量是 200K,不得更大', () => {
    expect(EXTREME_CONTEXT_WINDOW).toBe(200_000)
  })

  it('超量文本被压缩,图片保留', () => {
    const huge = '汉字批改材料'.repeat(80_000)
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'image' as const, data: 'IMGDATA', mimeType: 'image/jpeg' },
          { type: 'text' as const, text: huge },
        ],
        timestamp: 1,
      },
    ]
    const before = estimateExtremeTokens('system', messages as never)
    expect(before).toBeGreaterThan(EXTREME_CONTEXT_WINDOW)
    const { messages: out } = applyExtremeContextBudget('system', messages as never)
    const text = JSON.stringify(out)
    expect(text).toContain('已自动压缩')
    expect(text).toContain('IMGDATA')
    expect(text.length).toBeLessThan(huge.length)
    expect(estimateExtremeTokens('system', out)).toBeLessThan(before)
  })

  it('未超阈不改写', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: '请批改' }],
        timestamp: 1,
      },
    ]
    const r = applyExtremeContextBudget('短提示', messages as never)
    expect(r.systemPrompt).toBe('短提示')
    expect(r.messages).toEqual(messages)
  })
})

describe('gradePaperExtreme 子代理流程', () => {
  beforeEach(() => {
    mocks.complete.mockReset()
  })

  it('双核验通过:只调用初评+两个核验,给初评分数,不重裁', async () => {
    mocks.complete
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 10, 'q-2': 18 })))
      .mockResolvedValueOnce(assistant('{"passed":true,"summary":"对齐","issues":[]}'))
      .mockResolvedValueOnce(assistant('{"passed":true,"summary":"同意","issues":[]}'))

    const result = await gradePaperExtreme({
      task: makeTask(),
      paperId: 'paper-1',
      model: MODEL,
      apiKey: 'k',
      signal: new AbortController().signal,
      deps: { complete: mocks.complete, loadImages: async () => FAKE_IMAGES },
    })

    expect(mocks.complete).toHaveBeenCalledTimes(3)
    expect(result.totalScore).toBe(28)
    expect(result.questions).toHaveLength(2)
    const sessions = mocks.complete.mock.calls.map((c: unknown[]) => (c[2] as { sessionId: string }).sessionId)
    expect(sessions[0]).toContain('grading-extreme-grade:')
    expect(sessions[1]).toContain('grading-extreme-verify1:')
    expect(sessions[2]).toContain('grading-extreme-verify2:')
    // 两个核验是独立 session
    expect(sessions[1]).not.toBe(sessions[2])
  })

  it('核验不通过:重裁后由仲裁给分,不采用初评分数', async () => {
    mocks.complete
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 10, 'q-2': 20 }))) // 初评满分 30
      .mockResolvedValueOnce(
        assistant('{"passed":false,"summary":"偏高","issues":[{"questionId":"q-2","reason":"步骤不全仍给满分"}]}'),
      )
      .mockResolvedValueOnce(assistant('{"passed":true,"summary":"同意核验1","issues":[]}'))
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 10, 'q-2': 16 }))) // 重裁 26,仍非最终
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 10, 'q-2': 14 }))) // 仲裁 24

    const result = await gradePaperExtreme({
      task: makeTask(),
      paperId: 'paper-1',
      model: MODEL,
      apiKey: 'k',
      signal: new AbortController().signal,
      deps: { complete: mocks.complete, loadImages: async () => FAKE_IMAGES },
    })

    expect(mocks.complete).toHaveBeenCalledTimes(5)
    expect(result.totalScore).toBe(24)
    expect(result.questions.find((q) => q.questionId === 'q-2')?.score).toBe(14)
    const sessions = mocks.complete.mock.calls.map((c: unknown[]) => (c[2] as { sessionId: string }).sessionId)
    expect(sessions[3]).toContain('grading-extreme-regrade:')
    expect(sessions[4]).toContain('grading-extreme-arbitrate:')
    // 用量合并了全部调用
    expect(result.usage?.input).toBe(100 * 5)
    expect(result.usage?.output).toBe(50 * 5)
  })

  it('核验子代理返回非法 JSON 视为不通过并进入重裁仲裁', async () => {
    mocks.complete
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 8, 'q-2': 10 })))
      .mockResolvedValueOnce(assistant('对不起我不能'))
      .mockResolvedValueOnce(assistant('{"passed":true,"issues":[]}'))
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 8, 'q-2': 12 })))
      .mockResolvedValueOnce(assistant(gradeJson({ 'q-1': 8, 'q-2': 11 })))

    const result = await gradePaperExtreme({
      task: makeTask(),
      paperId: 'paper-1',
      model: MODEL,
      apiKey: 'k',
      signal: new AbortController().signal,
      deps: { complete: mocks.complete, loadImages: async () => FAKE_IMAGES },
    })
    expect(mocks.complete).toHaveBeenCalledTimes(5)
    expect(result.totalScore).toBe(19)
  })
})
