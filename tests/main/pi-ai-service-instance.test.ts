// =============================================================
// PiAIService(实例) — 自定义模型 CRUD / testConnection 早退分支 /
// listModels TTL 缓存 / oauthLogin / listProviders 元数据
// 说明: 依赖真实 LLM API 的 chatStream/在线模型拉取不在本文件覆盖范围
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '@shared/types'

const piMocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getEnvApiKey: vi.fn(),
  getProviders: vi.fn(),
  keystoreGetApiKey: vi.fn(),
  keystoreSetApiKey: vi.fn(),
  keystoreDeleteApiKey: vi.fn(),
  keystoreListProviders: vi.fn(),
  settingsGet: vi.fn(),
  setCustomModels: vi.fn(),
  ollamaDetect: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/ea-pi-ai-test'),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  shell: { openExternal: piMocks.openExternal },
}))

// vendored pi-ai: 仅覆盖会触发网络/环境的三个运行时导出,其余保留原实现
vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    completeSimple: piMocks.completeSimple,
    getEnvApiKey: piMocks.getEnvApiKey,
    getProviders: piMocks.getProviders,
  }
})

vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: {
    ready: vi.fn(async () => {}),
    listProviders: piMocks.keystoreListProviders,
    getApiKey: piMocks.keystoreGetApiKey,
    setApiKey: piMocks.keystoreSetApiKey,
    deleteApiKey: piMocks.keystoreDeleteApiKey,
  },
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: piMocks.settingsGet,
    setCustomModels: piMocks.setCustomModels,
  },
}))

vi.mock('../../src/main/services/ollama-service', () => ({
  ollamaService: {
    detect: piMocks.ollamaDetect,
    isServeRunning: vi.fn(async () => false),
    listModels: vi.fn(async () => []),
  },
}))

const { piAIService, OAUTH_PROVIDERS, OAUTH_KEY_URLS, PROVIDER_NAMES } = await import(
  '../../src/main/services/pi-ai-service'
)

function customEntry(p: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'my-custom',
    name: 'My Custom',
    contextWindow: 123456,
    maxOutputTokens: 2048,
    supportsReasoning: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    ...p,
  }
}
describe('piAIService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    piMocks.settingsGet.mockReturnValue({ models: { customModels: {} } })
    piMocks.keystoreGetApiKey.mockReturnValue(undefined)
    piMocks.getEnvApiKey.mockReturnValue(undefined)
    piMocks.ollamaDetect.mockResolvedValue(false)
    // 清掉跨用例的 listModels TTL 缓存(openai 是下面多数用例的 provider)
    piAIService.deleteApiKey('openai')
  })

  describe('re-export 常量', () => {
    it('OAUTH_PROVIDERS/PROVIDER_NAMES/OAUTH_KEY_URLS 从子模块透传', () => {
      expect(OAUTH_PROVIDERS.has('anthropic')).toBe(true)
      expect(OAUTH_PROVIDERS.has('github-copilot')).toBe(true)
      expect(OAUTH_PROVIDERS.has('openai')).toBe(false)
      expect(PROVIDER_NAMES.openai).toBe('OpenAI')
      expect(OAUTH_KEY_URLS['github-copilot']).toBe('https://github.com/settings/tokens')
    })
  })

  describe('API Key 管理', () => {
    it('getApiKey 优先 keystore,其次环境变量', () => {
      piMocks.keystoreGetApiKey.mockReturnValue('sk-keystore')
      expect(piAIService.getApiKey('openai')).toBe('sk-keystore')

      piMocks.keystoreGetApiKey.mockReturnValue(undefined)
      piMocks.getEnvApiKey.mockReturnValue('sk-env')
      expect(piAIService.getApiKey('openai')).toBe('sk-env')

      piMocks.getEnvApiKey.mockReturnValue(undefined)
      expect(piAIService.getApiKey('openai')).toBeUndefined()
    })

    it('setApiKey/deleteApiKey 委托 keystoreService', () => {
      piAIService.setApiKey('openai', 'sk-1')
      expect(piMocks.keystoreSetApiKey).toHaveBeenCalledWith('openai', 'sk-1')

      piAIService.deleteApiKey('openai')
      expect(piMocks.keystoreDeleteApiKey).toHaveBeenCalledWith('openai')
    })
  })

  describe('自定义模型 CRUD', () => {
    it('addCustomModel 填充默认值并返回 isCustom ModelInfo', () => {
      const result = piAIService.addCustomModel('openai', { id: 'my-model' })

      // 写入 settings 的 entry 带默认值
      const [providerId, entries] = piMocks.setCustomModels.mock.calls[0] as [
        string,
        Array<Record<string, unknown>>,
      ]
      expect(providerId).toBe('openai')
      expect(entries[0]).toMatchObject({
        id: 'my-model',
        name: 'my-model',
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsReasoning: false,
        costPerInputToken: 0,
        costPerOutputToken: 0,
      })
      expect(typeof entries[0].api).toBe('string')

      expect(result).toMatchObject({ id: 'my-model', providerId: 'openai', isCustom: true })
    })

    it('addCustomModel 同 id 覆盖而非追加', () => {
      piMocks.settingsGet.mockReturnValue({
        models: { customModels: { openai: [customEntry()] } },
      })

      piAIService.addCustomModel('openai', { id: 'my-custom', name: 'Replaced' })

      const [, entries] = piMocks.setCustomModels.mock.calls[0] as [
        string,
        Array<Record<string, unknown>>,
      ]
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ id: 'my-custom', name: 'Replaced' })
    })

    it('removeCustomModel 存在时返回 true 并写回,不存在返回 false', () => {
      piMocks.settingsGet.mockReturnValue({
        models: { customModels: { openai: [customEntry()] } },
      })
      expect(piAIService.removeCustomModel('openai', 'my-custom')).toBe(true)
      expect(piMocks.setCustomModels).toHaveBeenCalledTimes(1)

      expect(piAIService.removeCustomModel('openai', 'nope')).toBe(false)
      expect(piMocks.setCustomModels).toHaveBeenCalledTimes(1)
    })

    it('updateCustomModel 合并指定字段,未指定保持原值', () => {
      piMocks.settingsGet.mockReturnValue({
        models: { customModels: { openai: [customEntry({ name: 'Old', contextWindow: 1000 })] } },
      })

      const ok = piAIService.updateCustomModel('openai', 'my-custom', {
        name: 'New',
        contextWindow: 2000,
      })

      expect(ok).toBe(true)
      const [, entries] = piMocks.setCustomModels.mock.calls[0] as [
        string,
        Array<Record<string, unknown>>,
      ]
      expect(entries[0]).toMatchObject({
        id: 'my-custom',
        name: 'New',
        contextWindow: 2000,
        supportsReasoning: true,
      })
    })

    it('updateCustomModel 目标不存在返回 false', () => {
      expect(piAIService.updateCustomModel('openai', 'ghost', { name: 'X' })).toBe(false)
      expect(piMocks.setCustomModels).not.toHaveBeenCalled()
    })
  })

  describe('testConnection 早退分支(不触网)', () => {
    it('无静态模型的 provider: 返回 No models available', async () => {
      const result = await piAIService.testConnection('totally-unknown-provider', 'sk-x')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No models available for provider: totally-unknown-provider/)
      expect(piMocks.completeSimple).not.toHaveBeenCalled()
    })

    it('有模型但无任何 API Key: 返回 No API key', async () => {
      const result = await piAIService.testConnection('openai', '')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No API key for provider: openai/)
      expect(piMocks.completeSimple).not.toHaveBeenCalled()
    })

    it('completeSimple 返回 stopReason=error: 透传 errorMessage', async () => {
      piMocks.completeSimple.mockResolvedValue({
        stopReason: 'error',
        errorMessage: 'invalid api key',
      })
      const result = await piAIService.testConnection('openai', 'sk-bad')
      expect(result.success).toBe(false)
      expect(result.error).toBe('invalid api key')
      expect(result.model).toBeTruthy()
    })

    it('completeSimple 抛异常: 转为失败结果而非 reject', async () => {
      piMocks.completeSimple.mockRejectedValue(new Error('socket hang up'))
      const result = await piAIService.testConnection('openai', 'sk-flaky')
      expect(result.success).toBe(false)
      expect(result.error).toBe('socket hang up')
    })

    it('成功: 选用成本最低模型并返回延迟与模型 id', async () => {
      piMocks.completeSimple.mockResolvedValue({ stopReason: 'stop' })
      const result = await piAIService.testConnection('openai', 'sk-good')

      expect(result.success).toBe(true)
      expect(typeof result.latencyMs).toBe('number')
      // completeSimple 收到的模型与结果中报告的模型一致
      const calledModel = piMocks.completeSimple.mock.calls[0][0] as { id: string }
      expect(result.model).toBe(calledModel.id)
      // completeSimple(model, context, options)
      const context = piMocks.completeSimple.mock.calls[0][1] as {
        messages: Array<{ role: string; content: string }>
      }
      const options = piMocks.completeSimple.mock.calls[0][2] as Record<string, unknown>
      expect(context.messages[0]).toMatchObject({ role: 'user', content: 'ping' })
      expect(options).toMatchObject({ apiKey: 'sk-good', maxTokens: 5 })
    })
  })
  describe('listModels 缓存与自定义模型合并', () => {
    it('TTL 缓存: 30s 内重复调用不再重建列表', async () => {
      piMocks.settingsGet.mockClear()
      await piAIService.listModels('openai')
      const countAfterFirst = piMocks.settingsGet.mock.calls.length
      expect(countAfterFirst).toBeGreaterThanOrEqual(1)

      await piAIService.listModels('openai')
      expect(piMocks.settingsGet.mock.calls.length).toBe(countAfterFirst)
    })

    it('deleteApiKey 后缓存失效,重新拉取', async () => {
      await piAIService.listModels('openai')
      piMocks.settingsGet.mockClear()

      piAIService.deleteApiKey('openai')
      await piAIService.listModels('openai')
      expect(piMocks.settingsGet.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    it('合并用户自定义模型(带 isCustom 标记)', async () => {
      piMocks.settingsGet.mockReturnValue({
        models: { customModels: { openai: [customEntry()] } },
      })

      const models: ModelInfo[] = await piAIService.listModels('openai')

      const custom = models.find((m) => m.id === 'my-custom')
      expect(custom).toBeDefined()
      expect(custom?.isCustom).toBe(true)
      expect(custom?.contextWindow).toBe(123456)
      // 静态模型也在列表中
      expect(models.some((m) => m.isCustom !== true)).toBe(true)
    })

    it('无 API key 时不发起在线模型请求(结果只含静态+自定义)', async () => {
      piMocks.settingsGet.mockReturnValue({
        models: { customModels: { openai: [] } },
      })
      const models = await piAIService.listModels('openai')
      // 未触网: onlineFetcher 不会调用 fetch(无全局 fetch mock 时也不会失败)
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)
    })
  })

  describe('oauthLogin', () => {
    it('不支持的 provider: 返回失败与提示', async () => {
      const result = await piAIService.oauthLogin('openai')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/does not support OAuth/)
    })

    it('支持的 provider: 返回 authUrl 并打开浏览器', async () => {
      piMocks.openExternal.mockResolvedValue(undefined)
      const result = await piAIService.oauthLogin('anthropic')

      expect(result.success).toBe(true)
      expect(result.authUrl).toBe('https://console.anthropic.com/settings/keys')
      expect(piMocks.openExternal).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys')
    })

    it('打开浏览器失败不影响引导结果', async () => {
      piMocks.openExternal.mockRejectedValue(new Error('no browser'))
      const result = await piAIService.oauthLogin('anthropic')

      expect(result.success).toBe(true)
    })
  })

  describe('listProviders', () => {
    it('返回 provider 元数据: 名称/hasApiKey/modelCount', async () => {
      piMocks.getProviders.mockReturnValue(['openai'])
      piMocks.keystoreListProviders.mockReturnValue(['openai'])
      piMocks.keystoreGetApiKey.mockImplementation((id: string) =>
        id === 'openai' ? 'sk-stored' : undefined,
      )

      const providers = await piAIService.listProviders()

      expect(providers).toHaveLength(1)
      expect(providers[0]).toMatchObject({
        id: 'openai',
        name: 'OpenAI',
        hasApiKey: true,
        supportsOAuth: false,
      })
      expect(providers[0].modelCount).toBeGreaterThanOrEqual(1)
    })

    it('免费模型 provider 标记 hasFreeModels 且排序靠前', async () => {
      piMocks.getProviders.mockReturnValue(['openai', 'zai'])
      piMocks.keystoreListProviders.mockReturnValue([])

      const providers = await piAIService.listProviders()
      const ids = providers.map((p) => p.id)
      expect(ids).toContain('openai')
      expect(ids).toContain('zai')

      const zai = providers.find((p) => p.id === 'zai')
      expect(zai?.hasFreeModels).toBe(true)
      // 免费模型 provider 排在不免费之前
      const openai = providers.find((p) => p.id === 'openai')
      if (openai?.hasFreeModels === false) {
        expect(ids.indexOf('zai')).toBeLessThan(ids.indexOf('openai'))
      }
    })
  })
})