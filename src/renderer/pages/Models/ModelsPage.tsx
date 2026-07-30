// =============================================================
// 模型管理中心页面
// 展示 Provider 列表 → 展开查看模型详情 → API Key 管理
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { DefaultModelConfig } from './components/DefaultModelConfig'
import { ProviderCard } from './components/ProviderCard'
import { useProviderModelsCache } from './hooks/useProviderModelsCache'
import { LocalModelsSection } from './LocalModelsSection'

const EMPTY_MODELS: ModelInfo[] = []

export function ModelsPage() {
  const { t } = useT()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const {
    modelsMap,
    modelsLoading,
    refreshTime,
    ensureLoaded,
    refresh: refreshModels,
    loadAll: loadAllProviderModels,
    clear: clearProviderCache,
    invalidateAndRefresh,
  } = useProviderModelsCache()
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [searchTerm, setSearchTerm] = useState('')

  // Ref mirror of apiKeyInputs so handleTestConnection can stay stable (deps: [])
  const apiKeyInputsRef = useRef(apiKeyInputs)
  apiKeyInputsRef.current = apiKeyInputs

  // 加载所有 Provider，完成后自动拉取已配置 provider 的模型
  const loadProviders = useCallback(async () => {
    try {
      const data = await getAPI().ai.listProviders()
      setProviders(data)
      // 批量加载所有已配置 API Key 的 provider 的模型列表（封装在 hook 内）
      await loadAllProviderModels(data)
    } catch (err) {
      console.error('[Models] Failed to load providers:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t, loadAllProviderModels])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // 展开 Provider 时加载模型列表（跳过已在加载中的 provider）
  // ensureLoaded 内部做缓存 + inflight 双重守卫
  const handleExpand = useCallback(
    async (providerId: string) => {
      if (expandedProvider === providerId) {
        setExpandedProvider(null)
        return
      }
      setExpandedProvider(providerId)
      await ensureLoaded(providerId)
    },
    [expandedProvider, ensureLoaded],
  )

  // 测试连接
  const handleTestConnection = useCallback(
    async (providerId: string) => {
      const apiKey = apiKeyInputsRef.current[providerId]
      if (!apiKey) {
        setTestResults((p) => ({ ...p, [providerId]: '请输入 API Key' }))
        return
      }
      setTestResults((p) => ({ ...p, [providerId]: '测试中...' }))
      try {
        const result = await getAPI().ai.testConnection(providerId, apiKey)
        if (result.success) {
          await getAPI().ai.setApiKey(providerId, apiKey)
          setTestResults((p) => ({
            ...p,
            [providerId]: `连接成功 (${result.latencyMs}ms) [${result.model}]`,
          }))
          loadProviders()
        } else {
          setTestResults((p) => ({ ...p, [providerId]: `失败: ${result.error}` }))
        }
      } catch {
        setTestResults((p) => ({ ...p, [providerId]: '连接错误' }))
      }
    },
    [loadProviders],
  )

  // 删除 API Key
  const handleDeleteApiKey = useCallback(
    async (providerId: string) => {
      try {
        await getAPI().ai.deleteApiKey(providerId)
        // 清理 modelsMap 缓存（封装在 hook 内）
        clearProviderCache(providerId)
        loadProviders()
        toast.success(`已删除 ${providerId} 的 API Key`)
        setTestResults((p) => ({ ...p, [providerId]: '已删除' }))
      } catch (err) {
        console.error(`[Models] Failed to delete API key for ${providerId}:`, err)
        toast.error(`删除 ${providerId} API Key 失败`)
      }
    },
    [loadProviders, clearProviderCache],
  )

  // OAuth 登录 — 调用主进程打开 provider 的 API Key 获取页面
  // 当前实现:引导式 API Key 获取(打开浏览器到 provider 的 key 管理页)
  // 用户手动复制 Key 后填入 API Key 输入框,点测试连接即可保存
  // 支持 OAuth 的 provider: anthropic / github-copilot / openai-codex
  const handleOAuthLogin = useCallback(async (providerId: string) => {
    try {
      setTestResults((p) => ({ ...p, [providerId]: '正在打开 OAuth 登录页面...' }))
      const result = await getAPI().ai.oauthLogin(providerId)
      if (result.success) {
        setTestResults((p) => ({
          ...p,
          [providerId]: `已在浏览器中打开登录页面,请复制 API Key 后填入上方输入框`,
        }))
        toast.info(`OAuth: 已打开 ${providerId} 登录页面,请复制 API Key 后填入输入框`)
      } else {
        setTestResults((p) => ({ ...p, [providerId]: `OAuth 失败: ${result.error}` }))
        toast.error(`OAuth 登录失败: ${result.error}`)
      }
    } catch (err) {
      console.error(`[Models] OAuth login failed for ${providerId}:`, err)
      const msg = err instanceof Error ? err.message : String(err)
      setTestResults((p) => ({ ...p, [providerId]: `OAuth 错误: ${msg}` }))
      toast.error(`OAuth 登录错误: ${msg}`)
    }
  }, [])

  // 注：刷新指定 Provider 模型列表的逻辑（原 handleRefreshModels）已封装为
  // useProviderModelsCache.refresh，通过 refreshModels 别名传给子组件 onRefreshModels。

  // 隐藏 Provider（加入黑名单）
  const handleHideProvider = useCallback(
    async (providerId: string) => {
      try {
        const settings = await getAPI().settings.get()
        // UI-2 修复: 可选链兜底,防止后端 settings 缺嵌套子对象时崩溃
        const blacklist = settings?.models?.providerBlacklist ?? []
        if (!blacklist.includes(providerId)) {
          await getAPI().settings.set('models.providerBlacklist', [...blacklist, providerId])
          toast.success(`已隐藏 ${providerId}`)
          loadProviders()
        }
      } catch (err) {
        toast.error(`隐藏失败: ${err}`)
      }
    },
    [loadProviders],
  )

  // 取消隐藏 Provider（从黑名单移除）
  const handleUnhideProvider = useCallback(
    async (providerId: string) => {
      try {
        const settings = await getAPI().settings.get()
        // UI-2 修复: 可选链兜底
        const blacklist = settings?.models?.providerBlacklist ?? []
        const next = blacklist.filter((id) => id !== providerId)
        await getAPI().settings.set('models.providerBlacklist', next)
        toast.success(`已取消隐藏 ${providerId}`)
        loadProviders()
      } catch (err) {
        toast.error(`取消隐藏失败: ${err}`)
      }
    },
    [loadProviders],
  )

  // 添加自定义模型到指定 Provider
  const handleAddCustomModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await getAPI().ai.addCustomModel({ providerId, modelId, name: modelId })
        toast.success(`已添加模型 ${modelId}`)
        // 刷新该 provider 的模型列表（封装在 hook 内）
        await invalidateAndRefresh(providerId)
      } catch (err) {
        toast.error(`添加模型失败: ${err}`)
      }
    },
    [invalidateAndRefresh],
  )

  // 更新自定义模型属性
  const handleUpdateCustomModel = useCallback(
    async (providerId: string, modelId: string, updates: Record<string, unknown>) => {
      try {
        const result = await getAPI().ai.updateCustomModel({
          providerId,
          modelId,
          ...updates,
        })
        if (result.success) {
          toast.success(`已更新模型 ${modelId}`)
          await invalidateAndRefresh(providerId)
        } else {
          toast.error(`更新模型 ${modelId} 失败`)
        }
      } catch (err) {
        toast.error(`更新模型失败: ${err}`)
      }
    },
    [invalidateAndRefresh],
  )

  // 删除自定义模型
  const handleDeleteCustomModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await getAPI().ai.deleteCustomModel(providerId, modelId)
        toast.success(`已删除模型 ${modelId}`)
        await invalidateAndRefresh(providerId)
      } catch (err) {
        toast.error(`删除模型失败: ${err}`)
      }
    },
    [invalidateAndRefresh],
  )

  const handleApiKeyChange = useCallback((providerId: string, value: string) => {
    setApiKeyInputs((prev) => ({ ...prev, [providerId]: value }))
  }, [])

  // 过滤有模型的 Provider（使用 useMemo 稳定引用，减少子组件不必要重渲染）
  const visibleProviders = useMemo(
    () =>
      (searchTerm
        ? providers.filter(
            (p) =>
              p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              p.id.toLowerCase().includes(searchTerm.toLowerCase()),
          )
        : providers
      ).filter((p) => !p.hidden),
    [providers, searchTerm],
  )

  const hiddenProviders = useMemo(() => providers.filter((p) => p.hidden), [providers])

  // 按有/无 API Key 分组
  const configuredProviders = useMemo(
    () => visibleProviders.filter((p) => p.hasApiKey),
    [visibleProviders],
  )
  const unconfiguredProviders = useMemo(
    () => visibleProviders.filter((p) => !p.hasApiKey),
    [visibleProviders],
  )

  return (
    <div className="h-full overflow-y-auto animate-fade-in">
      <PageHeader
        title={t('page.models.title')}
        size="md"
        actions={
          <>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索 Provider..."
              className={cn('w-64', INPUT_BASE)}
            />
            <button
              type="button"
              onClick={loadProviders}
              aria-label="刷新"
              className={btnStyle('secondary')}
            >
              刷新
            </button>
          </>
        }
      />
      <div className="p-6">
        <LocalModelsSection />

        {loading ? (
          <EmptyState icon="⏳" title="加载中..." />
        ) : (
          <div className="space-y-6">
            {/* 默认模型配置面板 */}
            <DefaultModelConfig
              providers={providers}
              modelsMap={modelsMap}
              modelsLoading={modelsLoading}
              onRefreshModels={refreshModels}
            />

            {/* 已配置的 Providers */}
            {configuredProviders.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-green-500 dark:text-green-400 uppercase tracking-wider mb-3">
                  已配置 ({configuredProviders.length})
                </h2>
                <div className="space-y-2">
                  {configuredProviders.map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      expanded={expandedProvider === p.id}
                      models={modelsMap[p.id] ?? EMPTY_MODELS}
                      modelsLoading={modelsLoading[p.id] ?? false}
                      apiKeyInput={apiKeyInputs[p.id] ?? ''}
                      testResult={testResults[p.id]}
                      onExpand={handleExpand}
                      onApiKeyChange={handleApiKeyChange}
                      onTest={handleTestConnection}
                      onDeleteKey={handleDeleteApiKey}
                      onOAuthLogin={handleOAuthLogin}
                      onRefreshModels={refreshModels}
                      onHideProvider={handleHideProvider}
                      onAddCustomModel={handleAddCustomModel}
                      onUpdateCustomModel={handleUpdateCustomModel}
                      onDeleteCustomModel={handleDeleteCustomModel}
                      refreshTime={refreshTime[p.id] ?? 0}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 未配置的 Providers */}
            {unconfiguredProviders.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  未配置 ({unconfiguredProviders.length})
                </h2>
                <div className="space-y-2">
                  {unconfiguredProviders.map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      expanded={expandedProvider === p.id}
                      models={modelsMap[p.id] ?? EMPTY_MODELS}
                      modelsLoading={modelsLoading[p.id] ?? false}
                      apiKeyInput={apiKeyInputs[p.id] ?? ''}
                      testResult={testResults[p.id]}
                      onExpand={handleExpand}
                      onApiKeyChange={handleApiKeyChange}
                      onTest={handleTestConnection}
                      onDeleteKey={handleDeleteApiKey}
                      onOAuthLogin={handleOAuthLogin}
                      onHideProvider={handleHideProvider}
                      onAddCustomModel={handleAddCustomModel}
                      onUpdateCustomModel={handleUpdateCustomModel}
                      onDeleteCustomModel={handleDeleteCustomModel}
                      refreshTime={refreshTime[p.id] ?? 0}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 已隐藏的 Providers */}
            {hiddenProviders.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                  已隐藏 ({hiddenProviders.length})
                </h2>
                <div className="space-y-1">
                  {hiddenProviders.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-4 py-2 rounded-lg bg-gray-100 dark:bg-surface-tertiary opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-gray-400">{p.name}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {p.modelCount} models
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnhideProvider(p.id)}
                        aria-label="取消隐藏"
                        className={btnStyle('ghost')}
                      >
                        取消隐藏
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
