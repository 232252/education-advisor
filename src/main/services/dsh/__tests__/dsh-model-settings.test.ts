import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureDshCatalogSource } from '../dsh-model-catalog'
import {
  configureDshModelSettings,
  getDshCurrentRoute,
  listDshModels,
  listDshProviders,
  selectDshRoute,
} from '../dsh-model-settings'
import { configureDshCredentials } from '../provider-patch'
import { readLlmProviders } from '../provider-profile-patch'

const glm = {
  id: 'glm-5.3-flash',
  name: 'GLM-5.3-Flash',
  api: 'openai-completions',
  contextWindow: 128000,
  maxTokens: 16000,
  input: ['text'],
  supportsReasoning: true,
  costPerInputToken: 0,
  costPerOutputToken: 0,
  costCacheRead: 0,
  costCacheWrite: 0,
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
}

const mini = {
  id: 'MiniMax-M3.1-Flash',
  name: 'MiniMax-M3.1-Flash',
  api: 'anthropic-messages',
  contextWindow: 100000,
  maxTokens: 8000,
  input: ['text'],
  supportsReasoning: false,
  costPerInputToken: 1,
  costPerOutputToken: 1,
  costCacheRead: 0,
  costCacheWrite: 0,
  baseUrl: '',
}

describe('dsh-model-settings', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-dsh-models-'))
    configureDshModelSettings(dir)
    configureDshCredentials({
      listProviders: () => ['zai-coding-cn'],
      getApiKey: () => 'sk-test',
    })
    configureDshCatalogSource({
      listProviders: () => [
        { id: 'zai-coding-cn', name: 'Z.AI CN', supportsOAuth: false },
        { id: 'minimax-cn', name: 'MiniMax CN', supportsOAuth: false },
      ],
      listModels: (id) => {
        if (id === 'zai-coding-cn') return [glm]
        if (id === 'minimax-cn') return [mini]
        return []
      },
    })
  })

  afterEach(async () => {
    configureDshCatalogSource(null)
    configureDshCredentials(null)
    configureDshModelSettings('')
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('lists providers from the DSH catalog and marks keystore keys', async () => {
    const providers = await listDshProviders()
    expect(providers.map((p) => p.id)).toEqual(['zai-coding-cn', 'minimax-cn'])
    expect(providers.find((p) => p.id === 'zai-coding-cn')?.hasApiKey).toBe(true)
    expect(providers.find((p) => p.id === 'minimax-cn')?.hasApiKey).toBe(false)
  })

  it('lists the clicked provider models from the DSH catalog', async () => {
    const models = await listDshModels('zai-coding-cn')
    expect(models).toHaveLength(1)
    expect(models[0]?.id).toBe('glm-5.3-flash')
    expect(models[0]?.providerId).toBe('zai-coding-cn')
  })

  it('writes the current route back into the official profile document', async () => {
    expect(getDshCurrentRoute()).toBeNull()
    selectDshRoute({ provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
    expect(getDshCurrentRoute()).toEqual({
      provider: 'zai-coding-cn',
      model: 'glm-5.3-flash',
      reasoningEffort: undefined,
    })
    const providers = readLlmProviders(dir)
    expect(providers['zai-coding-cn']).toMatchObject({
      apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
    })
    expect(providers['zai-coding-cn'].models).toBeUndefined()
  })
})
