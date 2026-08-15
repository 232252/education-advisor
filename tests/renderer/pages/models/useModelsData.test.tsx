// =============================================================
// useModelsData — 模型管理中心数据加载与动作 handlers 测试
// 覆盖: 初始加载/失败、handleExpand、测试连接各分支、删除 Key、
//       OAuth、隐藏/取消隐藏、自定义模型增删改、搜索过滤
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderInfo } from '@shared/types'

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listModels: vi.fn(),
  testConnection: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  oauthLogin: vi.fn(),
  addCustomModel: vi.fn(),
  updateCustomModel: vi.fn(),
  deleteCustomModel: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    ai: {
      listProviders: mocks.listProviders,
      listModels: mocks.listModels,
      testConnection: mocks.testConnection,
      setApiKey: mocks.setApiKey,
      deleteApiKey: mocks.deleteApiKey,
      oauthLogin: mocks.oauthLogin,
      addCustomModel: mocks.addCustomModel,
      updateCustomModel: mocks.updateCustomModel,
      deleteCustomModel: mocks.deleteCustomModel,
    },
    settings: {
      get: mocks.settingsGet,
      set: mocks.settingsSet,
    },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: toastMocks,
}))

import { useModelsData } from '../../../../src/renderer/pages/Models/hooks/useModelsData'

function providerInfo(p: Partial<ProviderInfo> & { id: string }): ProviderInfo {
  return { name: p.id, supportsOAuth: false, hasApiKey: false, modelCount: 0, ...p }
}

const FIXTURE: ProviderInfo[] = [
  providerInfo({ id: 'openai', name: 'OpenAI', hasApiKey: true, modelCount: 3 }),
  providerInfo({ id: 'anthropic', name: 'Anthropic', hasApiKey: false, modelCount: 2 }),
  providerInfo({ id: 'hidden-one', name: 'Hidden One', hidden: true }),
]

/** flush 初始 useEffect 的异步加载链 */
async function flushInitial(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderLoaded() {
  const rendered = renderHook(() => useModelsData())
  await flushInitial()
  return rendered
}
describe('useModelsData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProviders.mockResolvedValue(FIXTURE)
    mocks.listModels.mockResolvedValue([])
    mocks.settingsGet.mockResolvedValue({ models: { providerBlacklist: [] } })
    mocks.settingsSet.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始加载与派生数据', () => {
    it('加载 providers 完成后 loading=false 且正确分组', async () => {
      const { result } = await renderLoaded()

      expect(result.current.loading).toBe(false)
      expect(result.current.providers).toHaveLength(3)
      expect(mocks.listProviders).toHaveBeenCalledTimes(1)
      // 已配置 provider 会触发批量模型加载
      expect(mocks.listModels).toHaveBeenCalledWith('openai')

      // hidden 的 provider 进入 hiddenProviders,不参与分组
      expect(result.current.hiddenProviders.map((p) => p.id)).toEqual(['hidden-one'])
      // 按有无 API Key 分组(hidden-one 被排除在 visible 之外)
      expect(result.current.configuredProviders.map((p) => p.id)).toEqual(['openai'])
      expect(result.current.unconfiguredProviders.map((p) => p.id)).toEqual(['anthropic'])
    })

    it('listProviders 失败时 toast.error 且 loading=false', async () => {
      mocks.listProviders.mockRejectedValue(new Error('ipc down'))
      const { result } = await renderLoaded()

      expect(result.current.loading).toBe(false)
      expect(result.current.providers).toEqual([])
      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleExpand', () => {
    it('展开未加载的 provider 触发 listModels,再次点击收起', async () => {
      const { result } = await renderLoaded()
      // 初始 loadAll 只加载 hasApiKey 的 openai,anthropic 未加载
      mocks.listModels.mockClear()

      await act(async () => {
        await result.current.handleExpand('anthropic')
      })
      expect(result.current.expandedProvider).toBe('anthropic')
      expect(mocks.listModels).toHaveBeenCalledWith('anthropic')

      await act(async () => {
        await result.current.handleExpand('anthropic')
      })
      expect(result.current.expandedProvider).toBe(null)
      expect(mocks.listModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleTestConnection', () => {
    it('未输入 API Key 时提示且不发请求', async () => {
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleTestConnection('openai')
      })

      expect(result.current.testResults.openai).toBe('请输入 API Key')
      expect(mocks.testConnection).not.toHaveBeenCalled()
    })

    it('成功: 保存 Key 并显示延迟与模型,重新加载 providers', async () => {
      mocks.testConnection.mockResolvedValue({ success: true, latencyMs: 5, model: 'gpt-test' })
      mocks.setApiKey.mockResolvedValue(undefined)
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleApiKeyChange('openai', 'sk-test')
      })
      await act(async () => {
        await result.current.handleTestConnection('openai')
      })
      await flushInitial(2)

      expect(mocks.testConnection).toHaveBeenCalledWith('openai', 'sk-test')
      expect(mocks.setApiKey).toHaveBeenCalledWith('openai', 'sk-test')
      expect(result.current.testResults.openai).toBe('连接成功 (5ms) [gpt-test]')
      // 成功后触发 loadProviders 重新拉取
      expect(mocks.listProviders.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('失败且 error 为字符串: 显示 失败: <error>', async () => {
      mocks.testConnection.mockResolvedValue({ success: false, error: 'rate limited' })
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleApiKeyChange('openai', 'sk-bad')
      })
      await act(async () => {
        await result.current.handleTestConnection('openai')
      })

      expect(result.current.testResults.openai).toBe('失败: rate limited')
      expect(mocks.setApiKey).not.toHaveBeenCalled()
    })

    it('失败且 error 为对象: JSON 字符串化,避免 [object Object]', async () => {
      mocks.testConnection.mockResolvedValue({ success: false, error: { code: 401 } })
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleApiKeyChange('openai', 'sk-bad')
      })
      await act(async () => {
        await result.current.handleTestConnection('openai')
      })

      expect(result.current.testResults.openai).toBe('失败: {"code":401}')
    })

    it('testConnection 抛异常: 显示 连接错误', async () => {
      mocks.testConnection.mockRejectedValue(new Error('boom'))
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleApiKeyChange('openai', 'sk-x')
      })
      await act(async () => {
        await result.current.handleTestConnection('openai')
      })

      expect(result.current.testResults.openai).toBe('连接错误')
    })
  })
  describe('handleDeleteApiKey', () => {
    it('成功: 清理缓存 + 重新加载 + toast + testResults', async () => {
      mocks.deleteApiKey.mockResolvedValue(undefined)
      const { result } = await renderLoaded()

      // 先展开 anthropic 建立缓存 — 但初始 loadAll 只拉 openai
      mocks.listModels.mockClear()
      await act(async () => {
        await result.current.handleExpand('openai')
      })
      expect(result.current.modelsMap.openai).toEqual([])
      // 重新让 listModels 返回数据以便观察缓存被清理
      mocks.listModels.mockResolvedValue([{ id: 'gpt' }])

      await act(async () => {
        await result.current.handleDeleteApiKey('openai')
      })
      await flushInitial(2)

      expect(mocks.deleteApiKey).toHaveBeenCalledWith('openai')
      expect(toastMocks.success).toHaveBeenCalledWith('已删除 openai 的 API Key')
      expect(result.current.testResults.openai).toBe('已删除')
      // 缓存被 clear 后 loadProviders 重新加载,openai 模型被重新拉取一次
      const openaiCalls = mocks.listModels.mock.calls.filter((c) => c[0] === 'openai')
      expect(openaiCalls.length).toBe(1)
    })

    it('失败: toast.error', async () => {
      mocks.deleteApiKey.mockRejectedValue(new Error('denied'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDeleteApiKey('openai')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('删除 openai API Key 失败')
    })
  })

  describe('handleOAuthLogin', () => {
    it('成功: 提示已打开登录页面 + toast.info', async () => {
      mocks.oauthLogin.mockResolvedValue({ success: true })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleOAuthLogin('anthropic')
      })

      expect(result.current.testResults.anthropic).toContain('已在浏览器中打开登录页面')
      expect(toastMocks.info).toHaveBeenCalled()
    })

    it('success=false: 显示 OAuth 失败 + toast.error', async () => {
      mocks.oauthLogin.mockResolvedValue({ success: false, error: 'not supported' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleOAuthLogin('anthropic')
      })

      expect(result.current.testResults.anthropic).toBe('OAuth 失败: not supported')
      expect(toastMocks.error).toHaveBeenCalled()
    })

    it('抛异常: 显示 OAuth 错误 + toast.error', async () => {
      mocks.oauthLogin.mockRejectedValue(new Error('ipc broken'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleOAuthLogin('anthropic')
      })

      expect(result.current.testResults.anthropic).toBe('OAuth 错误: ipc broken')
      expect(toastMocks.error).toHaveBeenCalledWith('OAuth 登录错误: ipc broken')
    })
  })

  describe('handleHideProvider / handleUnhideProvider', () => {
    it('隐藏: blacklist 不含 id 时追加并写入 settings', async () => {
      mocks.settingsGet.mockResolvedValue({ models: { providerBlacklist: ['other'] } })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleHideProvider('openai')
      })

      expect(mocks.settingsSet).toHaveBeenCalledWith('models.providerBlacklist', [
        'other',
        'openai',
      ])
      expect(toastMocks.success).toHaveBeenCalledWith('已隐藏 openai')
    })

    it('隐藏: 已在 blacklist 时不重复写入', async () => {
      mocks.settingsGet.mockResolvedValue({ models: { providerBlacklist: ['openai'] } })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleHideProvider('openai')
      })

      expect(mocks.settingsSet).not.toHaveBeenCalled()
    })

    it('隐藏: settings.get 抛错时 toast.error', async () => {
      mocks.settingsGet.mockRejectedValue(new Error('settings down'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleHideProvider('openai')
      })

      expect(toastMocks.error).toHaveBeenCalled()
    })

    it('取消隐藏: 从 blacklist 移除', async () => {
      mocks.settingsGet.mockResolvedValue({ models: { providerBlacklist: ['openai', 'x'] } })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleUnhideProvider('openai')
      })

      expect(mocks.settingsSet).toHaveBeenCalledWith('models.providerBlacklist', ['x'])
      expect(toastMocks.success).toHaveBeenCalledWith('已取消隐藏 openai')
    })
  })
  describe('自定义模型增删改', () => {
    it('handleAddCustomModel 成功: 调用 API + toast + 刷新模型列表', async () => {
      mocks.addCustomModel.mockResolvedValue(undefined)
      mocks.listModels.mockResolvedValue([])
      const { result } = await renderLoaded()
      mocks.listModels.mockClear()

      await act(async () => {
        await result.current.handleAddCustomModel('openai', 'my-model')
      })

      expect(mocks.addCustomModel).toHaveBeenCalledWith({
        providerId: 'openai',
        modelId: 'my-model',
        name: 'my-model',
      })
      expect(toastMocks.success).toHaveBeenCalledWith('已添加模型 my-model')
      expect(mocks.listModels).toHaveBeenCalledWith('openai')
    })

    it('handleAddCustomModel 失败: toast.error', async () => {
      mocks.addCustomModel.mockRejectedValue(new Error('dup'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleAddCustomModel('openai', 'my-model')
      })

      expect(toastMocks.error).toHaveBeenCalled()
    })

    it('handleUpdateCustomModel success=true: toast.success 并刷新', async () => {
      mocks.updateCustomModel.mockResolvedValue({ success: true })
      const { result } = await renderLoaded()
      mocks.listModels.mockClear()

      await act(async () => {
        await result.current.handleUpdateCustomModel('openai', 'my-model', { name: 'New' })
      })

      expect(mocks.updateCustomModel).toHaveBeenCalledWith({
        providerId: 'openai',
        modelId: 'my-model',
        name: 'New',
      })
      expect(toastMocks.success).toHaveBeenCalledWith('已更新模型 my-model')
      expect(mocks.listModels).toHaveBeenCalledWith('openai')
    })

    it('handleUpdateCustomModel success=false: toast.error 不刷新', async () => {
      mocks.updateCustomModel.mockResolvedValue({ success: false })
      const { result } = await renderLoaded()
      mocks.listModels.mockClear()

      await act(async () => {
        await result.current.handleUpdateCustomModel('openai', 'my-model', { name: 'New' })
      })

      expect(toastMocks.error).toHaveBeenCalledWith('更新模型 my-model 失败')
      expect(mocks.listModels).not.toHaveBeenCalled()
    })

    it('handleUpdateCustomModel 抛异常: toast.error', async () => {
      mocks.updateCustomModel.mockRejectedValue(new Error('x'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleUpdateCustomModel('openai', 'my-model', { name: 'New' })
      })

      expect(toastMocks.error).toHaveBeenCalledWith('更新模型失败: Error: x')
    })

    it('handleDeleteCustomModel 成功: toast.success 并刷新', async () => {
      mocks.deleteCustomModel.mockResolvedValue(undefined)
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDeleteCustomModel('openai', 'my-model')
      })

      expect(mocks.deleteCustomModel).toHaveBeenCalledWith('openai', 'my-model')
      expect(toastMocks.success).toHaveBeenCalledWith('已删除模型 my-model')
    })

    it('handleDeleteCustomModel 失败: toast.error', async () => {
      mocks.deleteCustomModel.mockRejectedValue(new Error('x'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDeleteCustomModel('openai', 'my-model')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('删除模型失败: Error: x')
    })
  })

  describe('搜索与输入', () => {
    it('setSearchTerm 按 name/id 过滤(hidden provider 永不出现)', async () => {
      const { result } = await renderLoaded()

      // 名称子串匹配(大小写不敏感)
      act(() => {
        result.current.setSearchTerm('open')
      })
      expect(result.current.configuredProviders.map((p) => p.id)).toEqual(['openai'])
      expect(result.current.unconfiguredProviders).toEqual([])

      act(() => {
        result.current.setSearchTerm('ANTHROPIC')
      })
      expect(result.current.configuredProviders).toEqual([])
      expect(result.current.unconfiguredProviders.map((p) => p.id)).toEqual(['anthropic'])

      // id 匹配,但 provider 已被隐藏 → 两分组均为空
      act(() => {
        result.current.setSearchTerm('hidden-one')
      })
      expect(result.current.configuredProviders).toEqual([])
      expect(result.current.unconfiguredProviders).toEqual([])

      act(() => {
        result.current.setSearchTerm('no-match-xyz')
      })
      expect(result.current.configuredProviders).toEqual([])
      expect(result.current.unconfiguredProviders).toEqual([])
    })

    it('handleApiKeyChange 更新 apiKeyInputs', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleApiKeyChange('openai', 'sk-1')
      })
      expect(result.current.apiKeyInputs.openai).toBe('sk-1')
    })
  })
})