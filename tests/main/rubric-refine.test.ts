// =============================================================
// Rubric Refine 纯函数测试
// 覆盖: refineTargets(有参考答案才可细化) / buildRefinePrompt(题清单+扣分点契约)
//       cleanRefinedMarks(负数化/去重/钳制/合计封顶) / parseRefineResponse
//       (围栏剥离/未知题丢弃/同题首次/空清洗/非法输出拒绝)
// 依赖 mock 与 grading-pipeline.test 同套(pipeline 模块级 import)。
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/rubric-refine-test-${Date.now()}`
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
  buildRefinePrompt,
  cleanRefinedMarks,
  parseRefineResponse,
  refineTargets,
} from '../../src/main/services/grading/rubric-refine'

const RUBRIC = [
  {
    id: 'q-1',
    title: '一、选择题',
    fullMark: 30,
    order: 1,
    referenceAnswer: '1-5 BACDA 6-10 CCDAB',
  },
  { id: 'q-2', title: '二、解答题', fullMark: 20, order: 2, referenceAnswer: 'F=ma,先受力分析' },
  { id: 'q-3', title: '三、实验题', fullMark: 10, order: 3 }, // 无参考答案
]

describe('refineTargets', () => {
  it('只有带参考答案的题可细化', () => {
    expect(refineTargets(RUBRIC).map((q) => q.id)).toEqual(['q-1', 'q-2'])
    expect(refineTargets([{ ...RUBRIC[2] }])).toEqual([])
    expect(refineTargets([{ ...RUBRIC[0], referenceAnswer: '   ' }])).toEqual([])
  })
})

describe('buildRefinePrompt', () => {
  it('注入题清单(id/满分/参考答案)与扣分点契约;无参考答案的题不进清单', () => {
    const prompt = buildRefinePrompt(refineTargets(RUBRIC))
    expect(prompt).toContain('q-1')
    expect(prompt).toContain('q-2')
    expect(prompt).not.toContain('id: q-3')
    expect(prompt).toContain('BACDA')
    expect(prompt).toContain('F=ma')
    expect(prompt).toContain('points 一律为负数')
    expect(prompt).toContain('"items"')
    expect(prompt).toContain('只输出')
  })
})

describe('cleanRefinedMarks', () => {
  it('正数负数化/非法项丢弃/note 裁剪', () => {
    const cleaned = cleanRefinedMarks(
      [
        { points: 2, note: '单位未换算' }, // 正数 → -2
        { points: -3, note: '  计算错误  ' }, // 保留负数,trim
        { points: 0, note: '零' }, // 丢弃
        { points: Number.NaN, note: 'x' }, // 丢弃
        { points: -1, note: '' }, // 空 note 丢弃
        { points: -1, note: 'a'.repeat(80) }, // 裁 60
      ],
      20,
    )
    expect(cleaned).toEqual([
      { points: -2, note: '单位未换算' },
      { points: -3, note: '计算错误' },
      { points: -1, note: 'a'.repeat(60) },
    ])
  })

  it('同点去重; 单点绝对值钳到满分; 合计超满分的尾部点丢弃', () => {
    const cleaned = cleanRefinedMarks(
      [
        { points: -4, note: '公式错' },
        { points: -4, note: '公式错' }, // 完全同点去重
        { points: -6, note: '步骤缺失' }, // 合计 10
        { points: -3, note: '单位错' }, // 合计 13
        { points: -99, note: '离谱大点' }, // 单点 99 > 满分 13 → 钳 -13? 合计越界 → 丢
      ],
      13,
    )
    expect(cleaned).toEqual([
      { points: -4, note: '公式错' },
      { points: -6, note: '步骤缺失' },
      { points: -3, note: '单位错' },
    ])
  })

  it('单点超过满分时先钳到满分再计合计', () => {
    const cleaned = cleanRefinedMarks([{ points: -99, note: '全错' }], 13)
    expect(cleaned).toEqual([{ points: -13, note: '全错' }])
  })

  it('最多保留 12 个点', () => {
    const marks = Array.from({ length: 20 }, (_, i) => ({ points: -0.5, note: `点${i}` }))
    expect(cleanRefinedMarks(marks, 100)).toHaveLength(12)
  })
})

describe('parseRefineResponse', () => {
  it('标准 JSON 解析: 未知题丢弃、清洗生效', () => {
    const r = parseRefineResponse(
      JSON.stringify({
        items: [
          {
            id: 'q-1',
            marks: [
              { points: -5, note: '第 1 小题错' },
              { points: 5, note: '第 2 小题错' },
              { points: 0, note: '无效' },
            ],
          },
          { id: 'q-404', marks: [{ points: -5, note: 'x' }] },
        ],
      }),
      RUBRIC,
    )
    expect(r).toEqual([
      {
        id: 'q-1',
        presetMarks: [
          { points: -5, note: '第 1 小题错' },
          { points: -5, note: '第 2 小题错' },
        ],
      },
    ])
  })

  it('剥离围栏与前后噪声; 同题多次出现以首次为准', () => {
    const r = parseRefineResponse(
      '好的：\n```json\n{"items":[{"id":"q-2","marks":[{"points":-2,"note":"受力分析缺失"}]},{"id":"q-2","marks":[{"points":-9,"note":"后者应被忽略"}]}]}\n```\n以上',
      RUBRIC,
    )
    expect(r).toEqual([{ id: 'q-2', presetMarks: [{ points: -2, note: '受力分析缺失' }] }])
  })

  it('清洗后为空的题丢弃; 无任何有效题/缺 items → 抛错', () => {
    expect(() =>
      parseRefineResponse('{"items":[{"id":"q-2","marks":[{"points":0,"note":"x"}]}]}', RUBRIC),
    ).toThrow('没有可用')
    expect(() => parseRefineResponse('{"foo":1}', RUBRIC)).toThrow('items')
    expect(() => parseRefineResponse('完全不是 JSON', RUBRIC)).toThrow()
    expect(() =>
      parseRefineResponse('{"items":[{"id":"q-404","marks":[{"points":-2,"note":"x"}]}]}', RUBRIC),
    ).toThrow('没有可用')
  })
})
