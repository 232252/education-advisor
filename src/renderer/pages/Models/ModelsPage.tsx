// =============================================================
// 模型管理中心页面
// 展示 Provider 列表 → 展开查看模型详情 → API Key 管理
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

// 格式化 token 成本（美元/百万 token）
function formatCost(costPerToken: number): string {
  if (costPerToken === 0) return '免费'
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`
  return `$${perMillion.toFixed(2)}/M`
}

// 格式化上下文窗口大小
function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`
  return String(tokens)
}

export function ModelsPage() {
  const { t } = useT()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [modelsMap, setModelsMap] = useState<Record<string, ModelInfo[]>>({})
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({})
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [refreshTime, setRefreshTime] = useState<Record<string, number>>({})

  // 追踪正在加载中的 provider（防止重复请求导致闪烁）
  const inflightRef = useRef<Set<string>>(new Set())

  // 加载所有 Provider，完成后自动拉取已配置 provider 的模型
  const loadProviders = useCallback(async () => {
    try {
      const data = await getAPI().ai.listProviders()
      setProviders(data)
      // 自动加载所有已配置 API Key 的 provider 的模型列表
      const configured = data.filter((p) => p.hasApiKey)
      if (configured.length > 0) {
        // 标记所有正在加载的 provider，防止其他 effect 重复请求
        const loadingState: Record<string, boolean> = {}
        for (const p of configured) {
          loadingState[p.id] = true
          inflightRef.current.add(p.id)
        }
        setModelsLoading((prev) => ({ ...prev, ...loadingState }))

        const results = await Promise.allSettled(
          configured.map(async (p) => ({
            id: p.id,
            models: await getAPI().ai.listModels(p.id),
          })),
        )
        // 一次性更新 modelsMap 和 modelsLoading，减少中间渲染
        setModelsMap((prev) => {
          const next = { ...prev }
          for (const r of results) {
            if (r.status === 'fulfilled') next[r.value.id] = r.value.models
          }
          return next
        })
        const doneState: Record<string, boolean> = {}
        for (const p of configured) {
          doneState[p.id] = false
          inflightRef.current.delete(p.id)
        }
        setModelsLoading((prev) => ({ ...prev, ...doneState }))
      }
    } catch (err) {
      console.error('[Models] Failed to load providers:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // 展开 Provider 时加载模型列表（跳过已在加载中的 provider）
  const handleExpand = async (providerId: string) => {
    if (expandedProvider === providerId) {
      setExpandedProvider(null)
      return
    }
    setExpandedProvider(providerId)

    // 如果已有缓存或正在加载中，不重复请求
    if (modelsMap[providerId] || inflightRef.current.has(providerId)) {
      return
    }

    inflightRef.current.add(providerId)
    setModelsLoading((p) => ({ ...p, [providerId]: true }))
    try {
      const models = await getAPI().ai.listModels(providerId)
      setModelsMap((p) => ({ ...p, [providerId]: models }))
      setRefreshTime((p) => ({ ...p, [providerId]: Date.now() }))
    } catch (err) {
      console.error(`[Models] Failed to load models for ${providerId}:`, err)
    } finally {
      inflightRef.current.delete(providerId)
      setModelsLoading((p) => ({ ...p, [providerId]: false }))
    }
  }

  // 测试连接
  const handleTestConnection = async (providerId: string) => {
    const apiKey = apiKeyInputs[providerId]
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
  }

  // 删除 API Key
  const handleDeleteApiKey = async (providerId: string) => {
    try {
      await getAPI().ai.deleteApiKey(providerId)
      // 清理 modelsMap 缓存
      setModelsMap((prev) => {
        const next = { ...prev }
        delete next[providerId]
        return next
      })
      setRefreshTime((prev) => {
        const next = { ...prev }
        delete next[providerId]
        return next
      })
      loadProviders()
      toast.success(`已删除 ${providerId} 的 API Key`)
      setTestResults((p) => ({ ...p, [providerId]: '已删除' }))
    } catch (err) {
      console.error(`[Models] Failed to delete API key for ${providerId}:`, err)
      toast.error(`删除 ${providerId} API Key 失败`)
    }
  }

  // OAuth 登录 — 调用主进程打开 provider 的 API Key 获取页面
  // 当前实现:引导式 API Key 获取(打开浏览器到 provider 的 key 管理页)
  // 用户手动复制 Key 后填入 API Key 输入框,点测试连接即可保存
  // 支持 OAuth 的 provider: anthropic / github-copilot / openai-codex
  const handleOAuthLogin = async (providerId: string) => {
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
  }

  // 刷新指定 Provider 的模型列表（强制重新获取）
  // 使用 useCallback 稳定引用，避免 DefaultModelConfig.useEffect([onRefreshModels]) 无限循环
  const handleRefreshModels = useCallback(async (providerId: string) => {
    // 如果已经在加载中，跳过（防止 DefaultModelConfig mount 时和 loadProviders 重复请求）
    if (inflightRef.current.has(providerId)) return
    inflightRef.current.add(providerId)
    setModelsLoading((p) => ({ ...p, [providerId]: true }))
    try {
      const models = await getAPI().ai.listModels(providerId)
      setModelsMap((p) => ({ ...p, [providerId]: models }))
    } catch (err) {
      console.error(`[Models] Failed to refresh models for ${providerId}:`, err)
      toast.error(`刷新 ${providerId} 模型失败`)
    } finally {
      inflightRef.current.delete(providerId)
      setModelsLoading((p) => ({ ...p, [providerId]: false }))
    }
  }, [])

  // 隐藏 Provider（加入黑名单）
  const handleHideProvider = async (providerId: string) => {
    try {
      const settings = await getAPI().settings.get()
      const blacklist = settings.models.providerBlacklist ?? []
      if (!blacklist.includes(providerId)) {
        await getAPI().settings.set('models.providerBlacklist', [...blacklist, providerId])
        toast.success(`已隐藏 ${providerId}`)
        loadProviders()
      }
    } catch (err) {
      toast.error(`隐藏失败: ${err}`)
    }
  }

  // 取消隐藏 Provider（从黑名单移除）
  const handleUnhideProvider = async (providerId: string) => {
    try {
      const settings = await getAPI().settings.get()
      const blacklist = settings.models.providerBlacklist ?? []
      const next = blacklist.filter((id) => id !== providerId)
      await getAPI().settings.set('models.providerBlacklist', next)
      toast.success(`已取消隐藏 ${providerId}`)
      loadProviders()
    } catch (err) {
      toast.error(`取消隐藏失败: ${err}`)
    }
  }

  // 添加自定义模型到指定 Provider
  const handleAddCustomModel = async (providerId: string, modelId: string) => {
    try {
      await getAPI().ai.addCustomModel({ providerId, modelId, name: modelId })
      toast.success(`已添加模型 ${modelId}`)
      // 刷新该 provider 的模型列表
      setModelsLoading((p) => ({ ...p, [providerId]: true }))
      const models = await getAPI().ai.listModels(providerId)
      setModelsMap((p) => ({ ...p, [providerId]: models }))
      setModelsLoading((p) => ({ ...p, [providerId]: false }))
    } catch (err) {
      toast.error(`添加模型失败: ${err}`)
    }
  }

  // 更新自定义模型属性
  const handleUpdateCustomModel = async (
    providerId: string,
    modelId: string,
    updates: Record<string, unknown>,
  ) => {
    try {
      const result = await getAPI().ai.updateCustomModel({
        providerId,
        modelId,
        ...updates,
      })
      if (result.success) {
        toast.success(`已更新模型 ${modelId}`)
        setModelsLoading((p) => ({ ...p, [providerId]: true }))
        const models = await getAPI().ai.listModels(providerId)
        setModelsMap((p) => ({ ...p, [providerId]: models }))
        setModelsLoading((p) => ({ ...p, [providerId]: false }))
      } else {
        toast.error(`更新模型 ${modelId} 失败`)
      }
    } catch (err) {
      toast.error(`更新模型失败: ${err}`)
    }
  }

  // 删除自定义模型
  const handleDeleteCustomModel = async (providerId: string, modelId: string) => {
    try {
      await getAPI().ai.deleteCustomModel(providerId, modelId)
      toast.success(`已删除模型 ${modelId}`)
      setModelsLoading((p) => ({ ...p, [providerId]: true }))
      const models = await getAPI().ai.listModels(providerId)
      setModelsMap((p) => ({ ...p, [providerId]: models }))
      setModelsLoading((p) => ({ ...p, [providerId]: false }))
    } catch (err) {
      toast.error(`删除模型失败: ${err}`)
    }
  }

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
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('page.models.title')}</h1>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索 Provider..."
            className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-64
                       focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={loadProviders}
            className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-2 rounded-lg text-sm transition-colors"
          >
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 dark:text-gray-500 py-12">加载中...</div>
      ) : (
        <div className="space-y-6">
          {/* 默认模型配置面板 */}
          <DefaultModelConfig
            providers={providers}
            modelsMap={modelsMap}
            modelsLoading={modelsLoading}
            onRefreshModels={handleRefreshModels}
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
                    models={modelsMap[p.id] ?? []}
                    modelsLoading={modelsLoading[p.id] ?? false}
                    apiKeyInput={apiKeyInputs[p.id] ?? ''}
                    testResult={testResults[p.id]}
                    onExpand={() => handleExpand(p.id)}
                    onApiKeyChange={(v) => setApiKeyInputs((prev) => ({ ...prev, [p.id]: v }))}
                    onTest={() => handleTestConnection(p.id)}
                    onDeleteKey={() => handleDeleteApiKey(p.id)}
                    onOAuthLogin={() => handleOAuthLogin(p.id)}
                    onRefreshModels={() => handleRefreshModels(p.id)}
                    onHideProvider={() => handleHideProvider(p.id)}
                    onAddCustomModel={(modelId) => handleAddCustomModel(p.id, modelId)}
                    onUpdateCustomModel={(modelId, updates) =>
                      handleUpdateCustomModel(p.id, modelId, updates)
                    }
                    onDeleteCustomModel={(modelId) => handleDeleteCustomModel(p.id, modelId)}
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
                    models={modelsMap[p.id] ?? []}
                    modelsLoading={modelsLoading[p.id] ?? false}
                    apiKeyInput={apiKeyInputs[p.id] ?? ''}
                    testResult={testResults[p.id]}
                    onExpand={() => handleExpand(p.id)}
                    onApiKeyChange={(v) => setApiKeyInputs((prev) => ({ ...prev, [p.id]: v }))}
                    onTest={() => handleTestConnection(p.id)}
                    onDeleteKey={() => handleDeleteApiKey(p.id)}
                    onOAuthLogin={() => handleOAuthLogin(p.id)}
                    onHideProvider={() => handleHideProvider(p.id)}
                    onAddCustomModel={(modelId) => handleAddCustomModel(p.id, modelId)}
                    onUpdateCustomModel={(modelId, updates) =>
                      handleUpdateCustomModel(p.id, modelId, updates)
                    }
                    onDeleteCustomModel={(modelId) => handleDeleteCustomModel(p.id, modelId)}
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
                    className="flex items-center justify-between px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800/50 opacity-60"
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
                      className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
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
  )
}

// =============================================================
// Provider 卡片组件
// =============================================================

interface ProviderCardProps {
  provider: ProviderInfo
  expanded: boolean
  models: ModelInfo[]
  modelsLoading: boolean
  apiKeyInput: string
  testResult?: string
  onExpand: () => void
  onApiKeyChange: (value: string) => void
  onTest: () => void
  onDeleteKey: () => void
  onOAuthLogin?: () => void
  onRefreshModels?: () => void
  onHideProvider?: () => void
  onAddCustomModel?: (modelId: string) => void
  onUpdateCustomModel?: (modelId: string, updates: Record<string, unknown>) => void
  onDeleteCustomModel?: (modelId: string) => void
  refreshTime?: number
}

function ProviderCard({
  provider,
  expanded,
  models,
  modelsLoading,
  apiKeyInput,
  testResult,
  onExpand,
  onApiKeyChange,
  onTest,
  onDeleteKey,
  onOAuthLogin,
  onRefreshModels,
  onHideProvider,
  onAddCustomModel,
  onUpdateCustomModel,
  onDeleteCustomModel,
  refreshTime,
}: ProviderCardProps) {
  const p = provider
  const [customModelInput, setCustomModelInput] = useState('')
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})

  return (
    <div
      className={`bg-gray-50 border rounded-xl transition-colors dark:bg-gray-800 ${
        expanded ? 'border-blue-500/50' : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      {/* 头部 — 点击展开 */}
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors rounded-t-xl"
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full ${p.hasApiKey ? 'bg-green-400' : 'bg-gray-400 dark:bg-gray-500'}`}
          />
          <h3 className="font-semibold text-base">{p.name}</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{p.id}</span>
          {p.hasApiKey && (
            <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
              已配置
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">{p.modelCount} 个模型</span>
          <svg
            className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            role="img"
            aria-label={expanded ? '收起' : '展开'}
          >
            <title>{expanded ? '收起' : '展开'}</title>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
          {/* API Key 管理 */}
          <div className="space-y-2">
            <label
              htmlFor={`apikey-${p.id}`}
              className="text-xs text-gray-500 dark:text-gray-400 font-medium"
            >
              API Key
            </label>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">
              输入 API Key 后点击测试连接。密钥加密存储在本地。
            </p>
            <div className="flex gap-2 items-center">
              <input
                id={`apikey-${p.id}`}
                type="password"
                value={apiKeyInput}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={p.hasApiKey ? '已保存（输入新值覆盖）' : '输入 API Key...'}
                className="flex-1 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={onTest}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
              >
                测试连接
              </button>
              {p.hasApiKey && (
                <button
                  type="button"
                  onClick={onDeleteKey}
                  className="bg-red-600/20 hover:bg-red-600/40 text-red-500 dark:text-red-400 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
                >
                  删除
                </button>
              )}
              {p.supportsOAuth && (
                <button
                  type="button"
                  onClick={onOAuthLogin}
                  className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
                  title="打开 provider 的 API Key 管理页面"
                >
                  OAuth 登录
                </button>
              )}
            </div>
            {testResult && (
              <div
                className={`text-xs ${
                  testResult.includes('成功') || testResult.includes('已删除')
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {testResult}
              </div>
            )}
          </div>

          {/* Provider 操作按钮 */}
          <div className="flex gap-2 items-center flex-wrap">
            {p.hasApiKey && onRefreshModels && (
              <button
                type="button"
                onClick={onRefreshModels}
                className="bg-green-600/20 hover:bg-green-600/40 text-green-500 dark:text-green-400 px-3 py-1.5 rounded-lg text-xs transition-colors"
              >
                刷新模型列表
              </button>
            )}
            {onHideProvider && (
              <button
                type="button"
                onClick={onHideProvider}
                className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs transition-colors"
              >
                隐藏此Provider
              </button>
            )}
            {refreshTime !== undefined && refreshTime > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                最近刷新: {new Date(refreshTime).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* 模型列表 */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">模型列表</div>
            {modelsLoading ? (
              <div className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
                加载模型中...
              </div>
            ) : models.length === 0 ? (
              <div className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
                暂无模型
              </div>
            ) : (
              <div className="bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                      <th className="text-left px-3 py-2 font-medium">模型</th>
                      <th className="text-left px-3 py-2 font-medium">API</th>
                      <th className="text-right px-3 py-2 font-medium">上下文</th>
                      <th className="text-right px-3 py-2 font-medium">最大输出</th>
                      <th className="text-right px-3 py-2 font-medium">输入成本</th>
                      <th className="text-right px-3 py-2 font-medium">输出成本</th>
                      <th className="text-center px-3 py-2 font-medium">推理</th>
                      {(onUpdateCustomModel || onDeleteCustomModel) && (
                        <th className="text-center px-3 py-2 font-medium w-20">操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <ModelRow
                        key={m.id}
                        model={m}
                        isEditing={editingModelId === m.id}
                        editForm={editingModelId === m.id ? editForm : {}}
                        onStartEdit={() => {
                          setEditingModelId(m.id)
                          setEditForm({
                            name: m.name,
                            api: m.api,
                            contextWindow: String(m.contextWindow),
                            maxOutputTokens: String(m.maxOutputTokens),
                            costPerInputToken: String(m.costPerInputToken),
                            costPerOutputToken: String(m.costPerOutputToken),
                            supportsReasoning: m.supportsReasoning ? 'true' : 'false',
                            baseUrl: m.baseUrl || '',
                          })
                        }}
                        onCancelEdit={() => setEditingModelId(null)}
                        onSaveEdit={() => {
                          if (onUpdateCustomModel) {
                            const updates: Record<string, unknown> = {}
                            if (editForm.name !== m.name) updates.name = editForm.name
                            if (editForm.api !== m.api) updates.api = editForm.api
                            if (Number(editForm.contextWindow) !== m.contextWindow)
                              updates.contextWindow = Number(editForm.contextWindow)
                            if (Number(editForm.maxOutputTokens) !== m.maxOutputTokens)
                              updates.maxOutputTokens = Number(editForm.maxOutputTokens)
                            if (Number(editForm.costPerInputToken) !== m.costPerInputToken)
                              updates.costPerInputToken = Number(editForm.costPerInputToken)
                            if (Number(editForm.costPerOutputToken) !== m.costPerOutputToken)
                              updates.costPerOutputToken = Number(editForm.costPerOutputToken)
                            if ((editForm.supportsReasoning === 'true') !== m.supportsReasoning)
                              updates.supportsReasoning = editForm.supportsReasoning === 'true'
                            if (editForm.baseUrl !== (m.baseUrl || ''))
                              updates.baseUrl = editForm.baseUrl
                            onUpdateCustomModel(m.id, updates)
                          }
                          setEditingModelId(null)
                        }}
                        onEditFormChange={setEditForm}
                        onDelete={onDeleteCustomModel ? () => onDeleteCustomModel(m.id) : undefined}
                        onUpdateAvailable={!!onUpdateCustomModel}
                        onDeleteAvailable={!!onDeleteCustomModel}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* 添加自定义模型 */}
            {onAddCustomModel && p.hasApiKey && (
              <div className="flex gap-2 items-center mt-2">
                <input
                  type="text"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customModelInput.trim()) {
                      onAddCustomModel(customModelInput.trim())
                      setCustomModelInput('')
                    }
                  }}
                  placeholder="输入自定义模型 ID..."
                  className="flex-1 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs
                             focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customModelInput.trim()) {
                      onAddCustomModel(customModelInput.trim())
                      setCustomModelInput('')
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap"
                >
                  添加模型
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================
// 模型行组件 — 支持显示/编辑模式切换（仅自定义模型可编辑）
// =============================================================

interface ModelRowProps {
  model: ModelInfo
  isEditing: boolean
  editForm: Record<string, string>
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onEditFormChange: (form: Record<string, string>) => void
  onDelete?: () => void
  onUpdateAvailable: boolean
  onDeleteAvailable: boolean
}

function ModelRow({
  model: m,
  isEditing,
  editForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditFormChange,
  onDelete,
  onUpdateAvailable,
  onDeleteAvailable,
}: ModelRowProps) {
  if (isEditing && m.isCustom) {
    // 编辑模式：显示可编辑表单
    return (
      <>
        <tr className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <td className="px-3 py-2">
            <div className="font-medium text-gray-700 dark:text-gray-200">{m.name}</div>
            <div className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">{m.id}</div>
            {m.isCustom && (
              <span className="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 rounded">
                自定义
              </span>
            )}
          </td>
          <td className="px-3 py-2">
            <select
              value={editForm.api ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, api: e.target.value })}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[10px] font-mono w-full"
            >
              <option value="openai-completions">openai-completions</option>
              <option value="openai-responses">openai-responses</option>
              <option value="anthropic-messages">anthropic-messages</option>
              <option value="mistral-conversations">mistral-conversations</option>
              <option value="google-generative-ai">google-generative-ai</option>
            </select>
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              value={editForm.contextWindow ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, contextWindow: e.target.value })}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              value={editForm.maxOutputTokens ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, maxOutputTokens: e.target.value })}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              step="0.0000001"
              value={editForm.costPerInputToken ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, costPerInputToken: e.target.value })}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              step="0.0000001"
              value={editForm.costPerOutputToken ?? ''}
              onChange={(e) =>
                onEditFormChange({ ...editForm, costPerOutputToken: e.target.value })
              }
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2 text-center">
            <select
              value={editForm.supportsReasoning ?? 'false'}
              onChange={(e) => onEditFormChange({ ...editForm, supportsReasoning: e.target.value })}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[10px] w-full"
            >
              <option value="true">R</option>
              <option value="false">-</option>
            </select>
          </td>
          <td className="px-3 py-2 text-center">
            <div className="flex items-center gap-1 justify-center">
              <button
                type="button"
                onClick={onSaveEdit}
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded text-[10px] transition-colors"
              >
                保存
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-0.5 rounded text-[10px] transition-colors"
              >
                取消
              </button>
            </div>
          </td>
        </tr>
        {/* Base URL 编辑行 */}
        <tr className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <td colSpan={8} className="px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Base URL:
              </span>
              <input
                type="text"
                value={editForm.baseUrl ?? ''}
                onChange={(e) => onEditFormChange({ ...editForm, baseUrl: e.target.value })}
                placeholder="留空使用 Provider 默认值"
                className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-[10px] font-mono"
              />
            </div>
          </td>
        </tr>
      </>
    )
  }

  // 显示模式
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-700 dark:text-gray-200">{m.name}</div>
        <div className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">{m.id}</div>
        {m.isCustom && (
          <span className="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 rounded">
            自定义
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <span className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300 font-mono text-[10px]">
          {m.api}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatContextWindow(m.contextWindow)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatContextWindow(m.maxOutputTokens)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatCost(m.costPerInputToken)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatCost(m.costPerOutputToken)}
      </td>
      <td className="px-3 py-2 text-center">
        {m.supportsReasoning ? (
          <span className="text-blue-500 dark:text-blue-400" title="支持推理">
            R
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-600">-</span>
        )}
      </td>
      {(onUpdateAvailable || onDeleteAvailable) && (
        <td className="px-3 py-2 text-center">
          {m.isCustom && (
            <div className="flex items-center gap-1 justify-center">
              {onUpdateAvailable && (
                <button
                  type="button"
                  onClick={onStartEdit}
                  className="text-blue-500 hover:text-blue-400 text-[10px] transition-colors"
                  title="编辑属性"
                >
                  编辑
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-red-500 hover:text-red-400 text-[10px] transition-colors"
                  title="删除"
                >
                  删除
                </button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  )
}

// =============================================================
// 默认模型配置组件 — 选择默认 Provider / 高质量模型 / 低成本模型
// =============================================================

interface DefaultModelConfigProps {
  providers: ProviderInfo[]
  modelsMap: Record<string, ModelInfo[]>
  modelsLoading: Record<string, boolean>
  onRefreshModels: (providerId: string) => Promise<void>
}

function DefaultModelConfig({
  providers,
  modelsMap,
  modelsLoading,
  onRefreshModels,
}: DefaultModelConfigProps) {
  const [defaultProvider, setDefaultProvider] = useState('')
  const [highQualityModel, setHighQualityModel] = useState('')
  const [lowCostModel, setLowCostModel] = useState('')
  // Override states: null = not editing (show computed default), string = user is editing
  const [customHQOverride, setCustomHQOverride] = useState<string | null>(null)
  const [customLQOverride, setCustomLQOverride] = useState<string | null>(null)
  const [saveToast, setSaveToast] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  // P2-6: 用 useAutoDismiss 替换散落的 setTimeout(成功 2s / 失败 3s)
  // 显式指定 <string> 避免 T 被推断为字面量 ''
  const setSaveToastAuto = useAutoDismiss<string>(setSaveToast, '', 3000)

  // Derived data (memoized to reduce re-renders)
  const configuredProviders = useMemo(() => providers.filter((p) => p.hasApiKey), [providers])
  const currentModels = useMemo(
    () => (defaultProvider ? (modelsMap[defaultProvider] ?? []) : []),
    [defaultProvider, modelsMap],
  )
  const isLoadingModels = defaultProvider ? (modelsLoading[defaultProvider] ?? false) : false
  const modelIds = useMemo(() => currentModels.map((m) => m.id), [currentModels])

  // Compute display values: if saved model is in the list, show in dropdown; otherwise show in custom input
  const hqInList = highQualityModel ? modelIds.includes(highQualityModel) : false
  const lqInList = lowCostModel ? modelIds.includes(lowCostModel) : false
  const hqDropdownValue = hqInList ? highQualityModel : ''
  const lqDropdownValue = lqInList ? lowCostModel : ''
  const hqCustomValue =
    customHQOverride !== null ? customHQOverride : !hqInList ? highQualityModel : ''
  const lqCustomValue = customLQOverride !== null ? customLQOverride : !lqInList ? lowCostModel : ''

  // Load settings on mount — 不触发 onRefreshModels，因为 loadProviders 已经批量加载了所有已配置 provider 的模型
  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true
    const loadSettings = async () => {
      try {
        const settings = await getAPI().settings.get()
        const prov = settings.models.defaultProvider || ''
        setDefaultProvider(prov)
        setHighQualityModel(settings.models.highQualityModel || '')
        setLowCostModel(settings.models.lowCostModel || '')
        // loadProviders 已批量加载所有 configured provider 的模型，不再重复请求
      } catch (err) {
        console.error('[DefaultModelConfig] Failed to load settings:', err)
        toast.error('加载默认模型设置失败')
      }
    }
    loadSettings()
  }, [])

  // Auto-save with toast notification
  const saveSetting = async (path: string, value: string) => {
    try {
      await getAPI().settings.set(path, value)
      setSaveToastAuto('已保存', 2000)
    } catch (err) {
      console.error(`[DefaultModelConfig] Failed to save ${path}:`, err)
      setSaveToastAuto('保存失败', 3000)
      toast.error(`保存设置失败: ${path}`)
    }
  }

  // --- Handlers ---

  const handleProviderChange = (value: string) => {
    setDefaultProvider(value)
    setHighQualityModel('')
    setLowCostModel('')
    setCustomHQOverride(null)
    setCustomLQOverride(null)
    saveSetting('models.defaultProvider', value)
    if (value) {
      onRefreshModels(value)
    }
  }

  const handleHQDropdown = (value: string) => {
    setHighQualityModel(value)
    setCustomHQOverride(null)
    saveSetting('models.highQualityModel', value)
  }

  const handleLQDropdown = (value: string) => {
    setLowCostModel(value)
    setCustomLQOverride(null)
    saveSetting('models.lowCostModel', value)
  }

  const commitCustomHQ = async () => {
    const value = (customHQOverride ?? '').trim()
    if (value && defaultProvider) {
      setHighQualityModel(value)
      saveSetting('models.highQualityModel', value)
      // 同时添加到 customModels 列表，让模型选择器可见
      try {
        await getAPI().ai.addCustomModel({
          providerId: defaultProvider,
          modelId: value,
          name: value,
        })
        onRefreshModels(defaultProvider)
      } catch (err) {
        console.warn('[DefaultModelConfig] Failed to add custom HQ model:', err)
      }
    }
    setCustomHQOverride(null)
  }

  const commitCustomLQ = async () => {
    const value = (customLQOverride ?? '').trim()
    if (value && defaultProvider) {
      setLowCostModel(value)
      saveSetting('models.lowCostModel', value)
      // 同时添加到 customModels 列表
      try {
        await getAPI().ai.addCustomModel({
          providerId: defaultProvider,
          modelId: value,
          name: value,
        })
        onRefreshModels(defaultProvider)
      } catch (err) {
        console.warn('[DefaultModelConfig] Failed to add custom LQ model:', err)
      }
    }
    setCustomLQOverride(null)
  }

  const handleRefresh = async () => {
    if (!defaultProvider) return
    setRefreshing(true)
    try {
      await onRefreshModels(defaultProvider)
    } finally {
      setRefreshing(false)
    }
  }

  // Lookup model info for currently selected values (for cost display)
  const hqModelInfo = currentModels.find((m) => m.id === highQualityModel)
  const lqModelInfo = currentModels.find((m) => m.id === lowCostModel)

  return (
    <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg">默认模型配置</h2>
        {saveToast && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full transition-opacity ${
              saveToast === '已保存'
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-red-500/20 text-red-600 dark:text-red-400'
            }`}
          >
            {saveToast}
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* ---- Default Provider ---- */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">默认 Provider</span>
          <select
            value={defaultProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-80
                       focus:outline-none focus:border-blue-500"
          >
            <option value="">请选择...</option>
            {configuredProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* ---- Model selection (only visible when a provider is selected) ---- */}
        {defaultProvider && (
          <>
            {/* Model count + refresh button */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-500">
                {isLoadingModels ? '加载模型中...' : `${currentModels.length} 个模型可用`}
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || isLoadingModels}
                className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                           disabled:opacity-50 disabled:cursor-not-allowed
                           px-3 py-1.5 rounded-lg text-xs transition-colors"
              >
                {refreshing || isLoadingModels ? '刷新中...' : '刷新模型列表'}
              </button>
            </div>

            {/* ---- High Quality Model ---- */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">高质量模型</span>
                  {hqModelInfo && (
                    <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">
                      输入 {formatCost(hqModelInfo.costPerInputToken)} / 输出{' '}
                      {formatCost(hqModelInfo.costPerOutputToken)}
                    </span>
                  )}
                </div>
                <select
                  value={hqDropdownValue}
                  onChange={(e) => handleHQDropdown(e.target.value)}
                  disabled={currentModels.length === 0}
                  className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-80
                             focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="">请选择...</option>
                  {currentModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} (输入 {formatCost(m.costPerInputToken)} / 输出{' '}
                      {formatCost(m.costPerOutputToken)})
                    </option>
                  ))}
                </select>
              </div>
              {/* Custom model ID input */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-500">
                  或输入自定义模型 ID
                </span>
                <input
                  type="text"
                  value={hqCustomValue}
                  onChange={(e) => setCustomHQOverride(e.target.value)}
                  onFocus={() => {
                    // Start editing: if override is null, initialize with current display value
                    if (customHQOverride === null && !hqInList && highQualityModel) {
                      setCustomHQOverride(highQualityModel)
                    }
                  }}
                  onBlur={() => commitCustomHQ()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitCustomHQ()
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder="例如 gpt-4-turbo-preview"
                  className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs w-80
                             focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* ---- Low Cost Model ---- */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">低成本模型</span>
                  {lqModelInfo && (
                    <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">
                      输入 {formatCost(lqModelInfo.costPerInputToken)} / 输出{' '}
                      {formatCost(lqModelInfo.costPerOutputToken)}
                    </span>
                  )}
                </div>
                <select
                  value={lqDropdownValue}
                  onChange={(e) => handleLQDropdown(e.target.value)}
                  disabled={currentModels.length === 0}
                  className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-80
                             focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="">请选择...</option>
                  {currentModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} (输入 {formatCost(m.costPerInputToken)} / 输出{' '}
                      {formatCost(m.costPerOutputToken)})
                    </option>
                  ))}
                </select>
              </div>
              {/* Custom model ID input */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-500">
                  或输入自定义模型 ID
                </span>
                <input
                  type="text"
                  value={lqCustomValue}
                  onChange={(e) => setCustomLQOverride(e.target.value)}
                  onFocus={() => {
                    if (customLQOverride === null && !lqInList && lowCostModel) {
                      setCustomLQOverride(lowCostModel)
                    }
                  }}
                  onBlur={() => commitCustomLQ()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitCustomLQ()
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder="例如 gpt-3.5-turbo"
                  className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs w-80
                             focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
