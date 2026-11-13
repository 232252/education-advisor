import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureDshCatalogSource } from '../dsh-model-catalog'
import {
  configureDshModelSettings,
  dshModelAcceptsImages,
  getDshCurrentRoute,
  listDshModels,
  listDshProviders,
  selectDshRoute,
  syncDshProviderCredential,
} from '../dsh-model-settings'
import { configureDshCredentials } from '../provider-patch'
import { mergeUncataloguedRouteModel, readLlmProviders } from '../provider-profile-patch'

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

  it('用户改名路由后，保存密钥把 apiKeyEnv 写进改名后的行', () => {
    configureDshCredentials({
      listProviders: () => ['zai-coding-cn'],
      getApiKey: () => 'sk-test',
      dshRoutes: () => ({ 'zai-coding-cn': 'my-gateway' }),
    })
    syncDshProviderCredential('zai-coding-cn')
    const providers = readLlmProviders(dir)
    expect(providers['my-gateway']).toMatchObject({
      apiKeyEnv: 'EAA_DSH_MY_GATEWAY_API_KEY',
    })
    expect(providers['zai-coding-cn']).toBeUndefined()
  })

  it('选择内建别名路由时，凭据写进 deepseek-official 行而不是 pi 旧名', () => {
    configureDshCredentials({
      listProviders: () => ['deepseek'],
      getApiKey: () => 'sk-test',
    })
    selectDshRoute({ provider: 'deepseek', model: 'deepseek-chat' })
    const providers = readLlmProviders(dir)
    expect(providers['deepseek-official']).toMatchObject({
      apiKeyEnv: 'EAA_DSH_DEEPSEEK_OFFICIAL_API_KEY',
    })
    expect(providers.deepseek).toBeUndefined()
  })

  it('只在官方目录标明接受图片时才算视觉模型', () => {
    expect(dshModelAcceptsImages('zai-coding-cn', 'glm-5.3-flash')).toBe(false)
    expect(dshModelAcceptsImages('minimax-cn', 'missing')).toBe(false)
    configureDshCatalogSource({
      listProviders: () => [],
      listModels: (id) => (id === 'zai-coding-cn' ? [{ ...glm, input: ['text', 'image'] }] : []),
    })
    expect(dshModelAcceptsImages('zai-coding-cn', 'glm-5.3-flash')).toBe(true)
  })

  it('目录没有的路由，profile 模型行声明 image 时也算视觉模型', async () => {
    mergeUncataloguedRouteModel(dir, 'my-gateway', {
      id: 'vl-model',
      input: ['text', 'image'],
    })
    expect(dshModelAcceptsImages('my-gateway', 'vl-model')).toBe(true)
    const models = await listDshModels('my-gateway')
    expect(models.find((m) => m.id === 'vl-model')?.supportsImage).toBe(true)
  })

  it('profile 模型行未声明图片时不猜视觉能力', async () => {
    mergeUncataloguedRouteModel(dir, 'my-gateway', { id: 'plain-model' })
    expect(dshModelAcceptsImages('my-gateway', 'plain-model')).toBe(false)
    const models = await listDshModels('my-gateway')
    expect(models.find((m) => m.id === 'plain-model')?.supportsImage).toBe(false)
  })

  it('目录外的模型用保守默认窗口，不猜 1M/128K（与自定义模型口径一致）', async () => {
    mergeUncataloguedRouteModel(dir, 'my-gateway', { id: 'unknown-model' })
    const models = await listDshModels('my-gateway')
    const m = models.find((x) => x.id === 'unknown-model')
    expect(m?.contextWindow).toBe(32768)
    expect(m?.maxOutputTokens).toBe(4096)
  })

  it('目录里有的模型仍用目录值，不被保守默认覆盖', async () => {
    const models = await listDshModels('zai-coding-cn')
    const m = models.find((x) => x.id === 'glm-5.3-flash')
    expect(m?.contextWindow).toBe(128000)
    expect(m?.maxOutputTokens).toBe(16000)
  })
})
