// =============================================================
// agent-model-selector 测试 — 模型选择/ApiKey 解析/续跑常量
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock settings-service
vi.mock('../settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      models: {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        highQualityModel: '',
        lowCostModel: '',
        customModels: {},
      },
    })),
  },
}))

// mock keystore-service
vi.mock('../keystore-service', () => ({
  keystoreService: {
    getApiKey: vi.fn(() => 'sk-test-key'),
  },
}))

// mock pi-ai/compat
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getEnvApiKey: vi.fn(() => undefined),
  getModel: vi.fn(() => undefined),
  getModels: vi.fn(() => []),
  getProviders: vi.fn(() => []),
}))

import { getModel, getModels } from '@earendil-works/pi-ai/compat'
import {
  hasApiKey,
  MAX_CONTINUATIONS,
  MIN_OUTPUT_CHARS,
  MIN_TURN_COUNT,
  resolveApiKey,
  safeCostScore,
  selectModel,
} from '../agent-model-selector'
import { keystoreService } from '../keystore-service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('续跑常量', () => {
  it('MAX_CONTINUATIONS = 5', () => {
    expect(MAX_CONTINUATIONS).toBe(5)
  })
  it('MIN_OUTPUT_CHARS = 200', () => {
    expect(MIN_OUTPUT_CHARS).toBe(200)
  })
  it('MIN_TURN_COUNT = 3', () => {
    expect(MIN_TURN_COUNT).toBe(3)
  })
})

describe('safeCostScore', () => {
  it('正常 cost 返回 input+output 之和', () => {
    const m = { cost: { input: 0.01, output: 0.02 } } as never
    expect(safeCostScore(m)).toBe(0.03)
  })
  it('cost 为 undefined 时,视为最贵(Infinity)——NaN 防御把无效值当 POSITIVE_INFINITY', () => {
    const m = {} as never
    expect(safeCostScore(m)).toBe(Number.POSITIVE_INFINITY)
  })
  it('cost 含 NaN 时,该字段视为 Infinity', () => {
    const m = { cost: { input: Number.NaN, output: 0.02 } } as never
    expect(safeCostScore(m)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('hasApiKey', () => {
  it('keystore 有 key 时返回 true', () => {
    vi.mocked(keystoreService.getApiKey).mockReturnValue('sk-xxx')
    expect(hasApiKey('openai')).toBe(true)
  })
  it('keystore 返回空字符串时返回 false', () => {
    vi.mocked(keystoreService.getApiKey).mockReturnValue('')
    expect(hasApiKey('openai')).toBe(false)
  })
})

describe('resolveApiKey', () => {
  it('优先返回 keystore 的 key', () => {
    vi.mocked(keystoreService.getApiKey).mockReturnValue('sk-from-keystore')
    expect(resolveApiKey('openai')).toBe('sk-from-keystore')
  })
})

describe('selectModel', () => {
  it('静态注册表命中(defaultModel)时返回静态模型', () => {
    const fakeModel = { id: 'gpt-4', api: 'openai-completions' }
    vi.mocked(getModel).mockReturnValue(fakeModel as never)
    const result = selectModel('high_quality')
    expect(result).toBe(fakeModel)
  })

  it('静态注册表未命中时,回退到 getModels 列表里 cost 最高的(high_quality)', () => {
    vi.mocked(getModel).mockReturnValue(undefined as never)
    // high_quality 选 cost 最高的
    const expensive = { id: 'expensive', api: 'openai', cost: { input: 0.05, output: 0.1 } }
    const cheap = { id: 'cheap', api: 'openai', cost: { input: 0.001, output: 0.002 } }
    vi.mocked(getModels).mockReturnValue([cheap, expensive] as never)
    const result = selectModel('high_quality')
    expect(result.id).toBe('expensive')
  })

  it('静态注册表未命中时,low_cost 回退到 getModels 里 cost 最低的', () => {
    vi.mocked(getModel).mockReturnValue(undefined as never)
    const expensive = { id: 'expensive', api: 'openai', cost: { input: 0.05, output: 0.1 } }
    const cheap = { id: 'cheap', api: 'openai', cost: { input: 0.001, output: 0.002 } }
    vi.mocked(getModels).mockReturnValue([expensive, cheap] as never)
    const result = selectModel('low_cost')
    expect(result.id).toBe('cheap')
  })
})
