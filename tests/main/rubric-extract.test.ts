// =============================================================
// Rubric Extract 纯函数测试
// 覆盖: buildRubricExtractPrompt(拆题粒度/答案规则/JSON 契约) /
//       parseRubricExtractResponse(围栏剥离/散文包裹/fullMark 默认与
//       钳制/空题名丢弃/同名去重/非法输出拒绝/referenceAnswer 容错)
// 依赖 mock: settings/keystore/grading-service(rubric-extract 经
//           grading-pipeline 模块级 import,纯函数不触达,仅保模块可加载)。
// =============================================================

import { describe, expect, it, vi } from 'vitest'

// rubric-extract → grading-pipeline → logger → utils/log/state 在模块加载期读 app.getPath('userData')
const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/rubric-extract-test-${Date.now()}`
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
  buildRubricExtractPrompt,
  parseRubricExtractResponse,
} from '../../src/main/services/grading/rubric-extract'

describe('buildRubricExtractPrompt', () => {
  it('包含拆题粒度/答案规则与 JSON 契约', () => {
    const prompt = buildRubricExtractPrompt()
    expect(prompt).toContain('最高层级题号')
    expect(prompt).toContain('不要抄录') // 不抄学生作答
    expect(prompt).toContain('fullMark')
    expect(prompt).toContain('AI 草稿') // 自答草稿的确认钩子
    expect(prompt).toContain('"questions"')
    expect(prompt).toContain('只输出')
    expect(prompt).toContain('"type"') // 题类契约(客观/主观)
    expect(prompt).toContain('objective')
  })
})

describe('parseRubricExtractResponse', () => {
  it('标准 JSON 解析(含题类)', () => {
    const r = parseRubricExtractResponse(
      '{"questions":[{"title":"一、选择题","type":"objective","fullMark":50,"referenceAnswer":"1-5 BACDA"},{"title":"二、解答题","fullMark":20}]}',
    )
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({
      title: '一、选择题',
      fullMark: 50,
      type: 'objective',
      referenceAnswer: '1-5 BACDA',
    })
    expect(r[1]?.type).toBeUndefined()
    expect(r[1]?.referenceAnswer).toBeUndefined()
  })

  it('type 白名单外的值丢弃为 undefined', () => {
    const r = parseRubricExtractResponse(
      '{"questions":[{"title":"甲","type":"essay","fullMark":5},{"title":"乙","type":"subjective","fullMark":5}]}',
    )
    expect(r[0]?.type).toBeUndefined()
    expect(r[1]?.type).toBe('subjective')
  })

  it('剥离 markdown 围栏与前后噪声', () => {
    const r = parseRubricExtractResponse(
      '好的，识别结果如下：\n```json\n{"questions":[{"title":"一、选择题","fullMark":50}]}\n```\n请核对。',
    )
    expect(r).toHaveLength(1)
    expect(r[0]?.title).toBe('一、选择题')
  })

  it('散文包裹时截取首尾大括号之间的片段', () => {
    const r = parseRubricExtractResponse(
      '识别出 2 道题：{"questions":[{"title":"第1题","fullMark":10},{"title":"第2题","fullMark":90}]} 以上供参考',
    )
    expect(r.map((q) => q.title)).toEqual(['第1题', '第2题'])
  })

  it('fullMark 非法默认 10,越界钳制到 ≤1000', () => {
    const r = parseRubricExtractResponse(
      '{"questions":[{"title":"甲","fullMark":"abc"},{"title":"乙","fullMark":-3},{"title":"丙","fullMark":5000}]}',
    )
    expect(r[0]?.fullMark).toBe(10)
    expect(r[1]?.fullMark).toBe(10)
    expect(r[2]?.fullMark).toBe(1000)
  })

  it('title 空/非字符串丢弃;空白 trim 后保留', () => {
    const r = parseRubricExtractResponse(
      '{"questions":[{"title":"  ","fullMark":5},{"title":123,"fullMark":5},{"title":" 有效题 ","fullMark":5}]}',
    )
    expect(r).toHaveLength(1)
    expect(r[0]?.title).toBe('有效题')
  })

  it('同名题去重保留首个', () => {
    const r = parseRubricExtractResponse(
      '{"questions":[{"title":"一、选择题","fullMark":50},{"title":"一、选择题","fullMark":60}]}',
    )
    expect(r).toHaveLength(1)
    expect(r[0]?.fullMark).toBe(50)
  })

  it('referenceAnswer 非字符串/空白 → undefined', () => {
    const r = parseRubricExtractResponse(
      '{"questions":[{"title":"甲","fullMark":10,"referenceAnswer":42},{"title":"乙","fullMark":10,"referenceAnswer":"   "}]}',
    )
    expect(r[0]?.referenceAnswer).toBeUndefined()
    expect(r[1]?.referenceAnswer).toBeUndefined()
  })

  it('缺 questions 数组 / 全部无效 → 抛错', () => {
    expect(() => parseRubricExtractResponse('{"foo":1}')).toThrow('questions')
    expect(() =>
      parseRubricExtractResponse('{"questions":[{"title":"","fullMark":5}]}'),
    ).toThrow('未识别出题目')
    expect(() => parseRubricExtractResponse('完全不是 JSON 的输出')).toThrow()
  })
})
