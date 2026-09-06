// =============================================================
// useModelsData — 模型管理中心数据加载与动作 handlers
// 状态与逻辑自 ModelsPage.tsx 逐字搬移,行为不变
// =============================================================

import type { ProviderInfo } from '@shared/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useIpcQuery } from '../../../hooks/useIpcQuery'
import { errText, getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { getHiddenProviders, getVisibleProviders, partitionByApiKey } from '../lib/providers-filter'
import { useProviderModelsCache } from './useProviderModelsCache'

// 稳定空数组引用,避免加载前每次渲染产生新引用
const EMPTY_PROVIDERS: ProviderInfo[] = []

export function useModelsData() {
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
  // 单源加载收口至 useIpcQuery(loading 仅首载置位,失败 toast;
  // onData 在 try 内 await — 级联加载模型列表抛错走失败路径,与原实现一致)
  const {
    data: providersData,
    loading,
    reload: loadProviders,
  } = useIpcQuery<ProviderInfo[]>(() => getAPI().ai.listProviders(), {
    loadingMode: 'initial',
    scope: 'Models',
    deps: [loadAllProviderModels],
    onData: (data) => loadAllProviderModels(data),
  })
  const providers = providersData ?? EMPTY_PROVIDERS
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [searchTerm, setSearchTerm] = useState('')

  // Ref mirror of apiKeyInputs so handleTestConnection can stay stable (deps: [])
  const apiKeyInputsRef = useRef(apiKeyInputs)
  apiKeyInputsRef.current = apiKeyInputs

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
          // 防御: provider SDK 的错误信息可能是对象, 统一转字符串避免 UI 显示 "[object Object]"
          setTestResults((p) => ({
            ...p,
            [providerId]: `失败: ${
              typeof result.error === 'string' ? result.error : JSON.stringify(result.error)
            }`,
          }))
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
      const msg = errText(err)
      setTestResults((p) => ({ ...p, [providerId]: `OAuth 错误: ${msg}` }))
      toast.error(`OAuth 登录错误: ${msg}`)
    }
  }, [])

  // 注：刷新指定 Provider 模型列表的逻辑（原 handleRefreshModels）已封装为
  // useProviderModelsCache.refresh，通过 refreshModels 别名传给子组件 onRefreshModels。

  // 黑名单加入/移除孪生动作参数化: 读旧黑名单 → 变更 → 保存 → toast → 刷新
  const mutateBlacklist = useCallback(
    async (providerId: string, add: boolean, okText: string, failText: string) => {
      try {
        const settings = await getAPI().settings.get()
        // UI-2 修复: 可选链兜底,防止后端 settings 缺嵌套子对象时崩溃
        const blacklist = settings?.models?.providerBlacklist ?? []
        const next = add
          ? blacklist.includes(providerId)
            ? blacklist
            : [...blacklist, providerId]
          : blacklist.filter((id) => id !== providerId)
        if (next === blacklist) return
        await getAPI().settings.set('models.providerBlacklist', next)
        toast.success(okText)
        loadProviders()
      } catch (err) {
        toast.error(`${failText}: ${err}`)
      }
    },
    [loadProviders],
  )

  // 隐藏/取消隐藏 Provider
  const handleHideProvider = useCallback(
    (providerId: string) => mutateBlacklist(providerId, true, `已隐藏 ${providerId}`, '隐藏失败'),
    [mutateBlacklist],
  )
  const handleUnhideProvider = useCallback(
    (providerId: string) =>
      mutateBlacklist(providerId, false, `已取消隐藏 ${providerId}`, '取消隐藏失败'),
    [mutateBlacklist],
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
    () => getVisibleProviders(providers, searchTerm),
    [providers, searchTerm],
  )

  const hiddenProviders = useMemo(() => getHiddenProviders(providers), [providers])

  // 按有/无 API Key 分组
  const { configuredProviders, unconfiguredProviders } = useMemo(
    () => partitionByApiKey(visibleProviders),
    [visibleProviders],
  )

  return {
    providers,
    loading,
    expandedProvider,
    modelsMap,
    modelsLoading,
    refreshTime,
    refreshModels,
    apiKeyInputs,
    testResults,
    searchTerm,
    setSearchTerm,
    configuredProviders,
    unconfiguredProviders,
    hiddenProviders,
    loadProviders,
    handleExpand,
    handleTestConnection,
    handleDeleteApiKey,
    handleOAuthLogin,
    handleHideProvider,
    handleUnhideProvider,
    handleAddCustomModel,
    handleUpdateCustomModel,
    handleDeleteCustomModel,
    handleApiKeyChange,
  }
}
