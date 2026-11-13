import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureDshCatalogSource } from '../dsh-model-catalog'
import {
  ensureEaaProviderProfilePatch,
  mergeLlmProviderCredentials,
  mergeProbeLlmConfig,
  mergeUncataloguedRouteModel,
  profileRouteFill,
  readDefaultModelSelection,
  readLlmProviders,
  syncUncataloguedRouteModels,
  withProfileCredentialRefs,
  writeDefaultModelSelection,
} from '../provider-profile-patch'

describe('ensureEaaProviderProfilePatch', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('把 llm-pi-ai providers 写入官方 profile 层，且不含密钥', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-patch-'))
    const path = ensureEaaProviderProfilePatch(dir, {
      'zai-coding-cn': {
        apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
        api: 'openai-completions',
        models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }],
      },
    })
    expect(path).toBe(join(dir, 'cordis.patch.yml'))
    const text = await readFile(path, 'utf8')
    expect(text).toContain('id: llm-pi-ai')
    expect(text).toContain('zai-coding-cn')
    expect(text).toContain('glm-5.3-flash')
    expect(text).toContain('EAA_DSH_ZAI_CODING_CN_API_KEY')
    expect(text).not.toMatch(/sk-|apiKey:\s*['"]?[^E]/)
  })

  it('保留 profile 里已有的其它行', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-patch-'))
    const existing = `# header
- id: ui-settings-general
  config:
    welcomeNoticeVersion: keep-me
`
    await writeFile(join(dir, 'cordis.patch.yml'), existing, 'utf8')
    ensureEaaProviderProfilePatch(dir, {
      'minimax-cn': { apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY' },
    })
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: ui-settings-general')
    expect(text).toContain('welcomeNoticeVersion: keep-me')
    expect(text).toContain('id: llm-pi-ai')
    expect(text).toContain('minimax-cn')
  })

  it('providers 为空时去掉 llm-pi-ai 行，不删其它行', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-patch-'))
    ensureEaaProviderProfilePatch(dir, {
      kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' },
    })
    await writeFile(
      join(dir, 'cordis.patch.yml'),
      `- id: keep
  config:
    x: 1
- id: llm-pi-ai
  config:
    providers:
      kimi:
        apiKeyEnv: EAA_DSH_KIMI_API_KEY
`,
      'utf8',
    )
    ensureEaaProviderProfilePatch(dir, {})
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: keep')
    expect(text).not.toContain('id: llm-pi-ai')
    expect(text).not.toContain('kimi')
  })
})

describe('mergeLlmProviderCredentials and default model', () => {
  let dir: string

  afterEach(async () => {
    configureDshCatalogSource(null)
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('merges apiKeyEnv without overwriting existing models or deleting other routes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-merge-'))
    ensureEaaProviderProfilePatch(dir, {
      'zai-coding-cn': {
        apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
        models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }],
      },
    })
    mergeLlmProviderCredentials(dir, {
      'zai-coding-cn': { apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY' },
      'minimax-cn': { apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY' },
    })
    const providers = readLlmProviders(dir)
    expect(providers['zai-coding-cn']).toMatchObject({
      apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
    })
    expect(providers['zai-coding-cn'].models).toEqual([
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' },
    ])
    expect(providers['minimax-cn']).toEqual({
      apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY',
    })
  })

  it('不覆盖 DSH 已经写好的 apiKeyEnv，并把这个名字并进启动环境', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-keep-ref-'))
    ensureEaaProviderProfilePatch(dir, {
      'minimax-cn': {
        apiKeyEnv: 'MINIMAX_CN_API_KEY',
        models: [{ id: 'MiniMax-M3', name: 'MiniMax-M3' }],
      },
    })
    mergeLlmProviderCredentials(dir, {
      'minimax-cn': { apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY' },
    })
    const providers = readLlmProviders(dir)
    expect(providers['minimax-cn'].apiKeyEnv).toBe('MINIMAX_CN_API_KEY')
    expect(providers['minimax-cn'].models).toEqual([{ id: 'MiniMax-M3', name: 'MiniMax-M3' }])
    const envNames = withProfileCredentialRefs(
      { EAA_DSH_MINIMAX_CN_API_KEY: 'minimax-cn' },
      { 'minimax-cn': { apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY' } },
      providers,
    )
    expect(envNames.MINIMAX_CN_API_KEY).toBe('minimax-cn')
    expect(envNames.EAA_DSH_MINIMAX_CN_API_KEY).toBe('minimax-cn')
  })

  it('缺的网关地址会补上，DSH 已有的地址和模型条目保持不变', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-base-'))
    ensureEaaProviderProfilePatch(dir, {
      openai: {
        apiKeyEnv: 'OPENAI_API_KEY',
        baseURL: 'https://dsh.example/v1',
        models: [{ id: 'keep-me', name: 'Keep' }],
      },
    })
    mergeLlmProviderCredentials(dir, {
      openai: {
        apiKeyEnv: 'EAA_DSH_OPENAI_API_KEY',
        baseURL: 'https://teacher.example/v1',
        models: [{ id: 'do-not-write', name: 'Nope' }],
      },
      kimi: profileRouteFill({
        apiKeyEnv: 'EAA_DSH_KIMI_API_KEY',
        baseURL: 'https://gateway.school.local/v1',
        timeoutMs: 45000,
        cacheRetention: 'short',
        retryPolicy: { mode: 'normal', maxRetries: 3, backoff: { initialDelayMs: 1000 } },
        models: [{ id: 'k2-turbo', name: 'K2' }],
      }),
    })
    const providers = readLlmProviders(dir)
    expect(providers.openai.baseURL).toBe('https://dsh.example/v1')
    expect(providers.openai.apiKeyEnv).toBe('OPENAI_API_KEY')
    expect(providers.openai.models).toEqual([{ id: 'keep-me', name: 'Keep' }])
    expect(providers.kimi).toEqual({
      apiKeyEnv: 'EAA_DSH_KIMI_API_KEY',
      baseURL: 'https://gateway.school.local/v1',
      timeoutMs: 45000,
      cacheRetention: 'short',
    })
    expect(providers.kimi.models).toBeUndefined()
    expect(providers.kimi.retryPolicy).toBeUndefined()
  })

  it('目录外的路由补上当前模型，已有模型和 api 保留', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-uncatalogued-'))
    ensureEaaProviderProfilePatch(dir, {
      gateway: {
        apiKeyEnv: 'EAA_DSH_GATEWAY_API_KEY',
        api: 'openai-completions',
        models: [{ id: 'kept', name: 'Kept' }],
      },
    })
    mergeUncataloguedRouteModel(
      dir,
      'gateway',
      { id: 'custom-1', name: 'Custom' },
      'anthropic-messages',
    )
    mergeUncataloguedRouteModel(
      dir,
      'gateway',
      { id: 'custom-1', name: 'Custom' },
      'anthropic-messages',
    )
    const providers = readLlmProviders(dir)
    expect(providers.gateway.api).toBe('openai-completions')
    expect(providers.gateway.models).toEqual([
      { id: 'kept', name: 'Kept' },
      { id: 'custom-1', name: 'Custom' },
    ])
  })

  it('目录外的多条模型一起补上，目录内的路由跳过', async () => {
    configureDshCatalogSource({
      listProviders: () => [],
      listModels: (id) =>
        id === 'kimi'
          ? [
              {
                id: 'k2',
                name: 'K2',
                api: 'openai-completions',
                contextWindow: 1,
                maxTokens: 1,
                input: ['text'],
                supportsReasoning: false,
                costPerInputToken: 0,
                costPerOutputToken: 0,
                costCacheRead: 0,
                costCacheWrite: 0,
                baseUrl: '',
              },
            ]
          : [],
    })
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-sync-models-'))
    syncUncataloguedRouteModels(
      dir,
      [
        { provider: 'kimi', model: 'k2' },
        { provider: 'gateway', model: 'custom-1' },
        { provider: 'gateway', model: 'custom-1' },
        { provider: 'gateway', model: 'custom-2' },
      ],
      (route, modelId) =>
        route === 'gateway' && modelId === 'custom-1'
          ? { id: modelId, api: 'openai-completions', contextWindow: 8000 }
          : undefined,
    )
    const providers = readLlmProviders(dir)
    expect(providers.kimi).toBeUndefined()
    expect(providers.gateway.api).toBe('openai-completions')
    expect(providers.gateway.models).toEqual([
      { id: 'custom-1', contextWindow: 8000 },
      { id: 'custom-2' },
    ])
    configureDshCatalogSource(null)
  })

  it('改路由时留下 llm-pi-ai 行上的其它字段', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-siblings-'))
    await writeFile(
      join(dir, 'cordis.patch.yml'),
      `${[
        '- id: llm-pi-ai',
        "  name: '@deepseek-ai/dsh-llm-pi-ai'",
        '  config:',
        '    note: keep',
        '    providers:',
        '      kimi:',
        '        apiKeyEnv: KIMI_API_KEY',
        '',
      ].join('\n')}`,
      'utf8',
    )
    mergeLlmProviderCredentials(dir, {
      gateway: { apiKeyEnv: 'EAA_DSH_GATEWAY_API_KEY', baseURL: 'https://gateway.school.local/v1' },
    })
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('note: keep')
    expect(text).toContain('name: "@deepseek-ai/dsh-llm-pi-ai"')
    expect(text).toContain('apiKeyEnv: KIMI_API_KEY')
    expect(text).toContain('apiKeyEnv: EAA_DSH_GATEWAY_API_KEY')
    expect(text).toContain('baseURL: https://gateway.school.local/v1')
  })

  it('探测补丁留下磁盘上的模型和旁路字段，试的那条路由改用这次的凭据名', () => {
    const config = mergeProbeLlmConfig(
      {
        note: 'keep',
        providers: {
          kimi: { apiKeyEnv: 'KIMI_API_KEY', models: [{ id: 'k2' }] },
        },
      },
      {
        kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY', models: [{ id: 'pinned' }] },
        gateway: {
          apiKeyEnv: 'EAA_DSH_GATEWAY_API_KEY',
          baseURL: 'https://gateway.school.local/v1',
          models: [{ id: 'custom-1' }],
        },
      },
      { route: 'gateway', envName: 'EAA_DSH_GATEWAY_API_KEY' },
    )
    expect(config.note).toBe('keep')
    expect(config.providers).toMatchObject({
      kimi: { apiKeyEnv: 'KIMI_API_KEY', models: [{ id: 'k2' }] },
      gateway: {
        apiKeyEnv: 'EAA_DSH_GATEWAY_API_KEY',
        baseURL: 'https://gateway.school.local/v1',
        models: [{ id: 'custom-1' }],
      },
    })
  })

  it('writes and reads official agent-default-model without secrets', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-default-'))
    writeDefaultModelSelection(dir, { provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
    expect(readDefaultModelSelection(dir)).toEqual({
      provider: 'zai-coding-cn',
      model: 'glm-5.3-flash',
      reasoningEffort: undefined,
    })
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: agent-default-model')
    expect(text).toContain('glm-5.3-flash')
    expect(text).not.toMatch(/sk-/)
  })
})
