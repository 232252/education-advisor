// =============================================================
// useProviderModelsCache — Provider 模型列表缓存
// 封装 modelsMap/modelsLoading/inflightRef/refreshTime 状态 +
// ensureLoaded/refresh/loadAll/clear/invalidateAndRefresh 操作,
// 消除 ModelsPage 里分散的缓存读取/失效样板。
//
// 行为对齐原 ModelsPage.tsx 的 4 处分散逻辑：
//   - ensureLoaded  ← 原 handleExpand 的模型拉取分支
//                    (缓存 + inflight 双重守卫; 成功时更新 refreshTime;
//                     失败仅 console.error, 不 toast)
//   - refresh      ← 原 handleRefreshModels
//                    (仅 inflight 守卫; 不更新 refreshTime;
//                     失败 toast.error — 保留原行为以匹配用户感知)
//   - loadAll      ← 原 loadProviders 的批量拉取分支
//                    (Promise.allSettled; 单个失败不影响其他;
//                     直接操作 inflightRef, 不走单 provider 路径)
//   - clear        ← 原 handleDeleteApiKey 的缓存清理
//                    (删除 modelsMap/refreshTime 对应 key)
//   - invalidateAndRefresh ← 原 handleAddCustomModel /
//                    handleUpdateCustomModel / handleDeleteCustomModel
//                    的内联刷新 (不检查 inflight; 不更新 refreshTime;
//                     不 toast 失败 —— 外层 handler 已 toast 业务结果)
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { useCallback, useRef, useState } from 'react'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useProviderModelsCache() {
  const [modelsMap, setModelsMap] = useState<Record<string, ModelInfo[]>>({})
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({})
  const [refreshTime, setRefreshTime] = useState<Record<string, number>>({})
  // 追踪正在加载中的 provider（防止重复请求导致闪烁）
  const inflightRef = useRef<Set<string>>(new Set())

  // 展开 Provider / 切换默认 Provider 时调用:已有缓存或正在加载则跳过
  // 对应原 handleExpand 的模型拉取分支 (biome useExhaustiveDependencies 豁免原因:
  // modelsMap 仅作缓存判断, stale closure 由 inflightRef 兜底)
  const ensureLoaded = useCallback(
    async (providerId: string) => {
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
    },
    [modelsMap],
  )

  // 强制刷新指定 Provider 的模型列表 (DefaultModelConfig / ProviderCard 的刷新按钮)
  // 使用 useCallback 稳定引用，避免 DefaultModelConfig.useEffect([onRefreshModels]) 无限循环
  const refresh = useCallback(async (providerId: string) => {
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

  // 批量加载多个已配置 Provider 的模型 (loadProviders 调用)
  // 直接操作 inflightRef, Promise.allSettled 保证单个失败不影响其他
  const loadAll = useCallback(async (providers: ProviderInfo[]) => {
    const configured = providers.filter((p) => p.hasApiKey)
    if (configured.length === 0) return

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
  }, [])

  // 清除指定 Provider 的缓存 (删除 API Key 后调用)
  const clear = useCallback((providerId: string) => {
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
  }, [])

  // 自定义模型增删改后调用:强制重新拉取 (不检查 inflight, 不更新 refreshTime, 不 toast 失败)
  // 外层 handler 已就业务结果 (success/failure) 给出 toast
  const invalidateAndRefresh = useCallback(async (providerId: string) => {
    setModelsLoading((p) => ({ ...p, [providerId]: true }))
    try {
      const models = await getAPI().ai.listModels(providerId)
      setModelsMap((p) => ({ ...p, [providerId]: models }))
    } finally {
      setModelsLoading((p) => ({ ...p, [providerId]: false }))
    }
  }, [])

  // 读取指定 Provider 的模型列表 (缓存命中返回数组, 否则返回空数组)
  const getModels = useCallback((providerId: string) => modelsMap[providerId] ?? [], [modelsMap])

  return {
    modelsMap,
    modelsLoading,
    refreshTime,
    ensureLoaded,
    refresh,
    loadAll,
    clear,
    invalidateAndRefresh,
    getModels,
  }
}
