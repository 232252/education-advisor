import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/tmp/ea-cost-test',
    isPackaged: false,
  },
}))

import type { Api, Model } from '../../src/main/services/llm-contracts'
import {
  buildStaticModelInfos,
  catalogUsdPerMillionToPerToken,
} from '../../src/main/services/pi-ai/model-utils'

function catalogModel(cost: { input: number; output: number; cacheRead: number; cacheWrite: number }): Model<Api> {
  return {
    id: 'glm-4.6v',
    name: 'GLM-4.6V',
    api: 'openai-completions',
    provider: 'zai-coding-cn',
    baseUrl: 'https://example.invalid',
    reasoning: true,
    input: ['text', 'image'],
    cost,
    contextWindow: 128000,
    maxTokens: 32768,
  } as Model<Api>
}

describe('catalog cost units', () => {
  it('目录里的美元/百万 token 换成每 token，界面再乘回百万才是标价', () => {
    expect(catalogUsdPerMillionToPerToken(0.3)).toBeCloseTo(0.0000003)
    const [info] = buildStaticModelInfos([
      catalogModel({ input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 }),
    ])
    expect(info.costPerInputToken * 1_000_000).toBeCloseTo(0.3)
    expect(info.costPerOutputToken * 1_000_000).toBeCloseTo(0.9)
    expect(info.costPerInputToken * 1_000_000).not.toBeCloseTo(300000)
  })
})
