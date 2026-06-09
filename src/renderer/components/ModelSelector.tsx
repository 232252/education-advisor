// =============================================================
// 模型选择器组件 — 在聊天输入区选择 Provider + Model
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAPI } from '../lib/ipc-client'
import { toast } from '../stores/toastStore'

interface ModelSelectorProps {
  selectedProvider: string
  selectedModel: string
  onSelect: (providerId: string, modelId: string) => void
}

export function ModelSelector({ selectedProvider, selectedModel, onSelect }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({})
  const modelsRef = useRef<Record<string, ModelInfo[]>>({})
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 使用 ref 保存最新的 onSelect / selectedProvider / selectedModel，避免 useEffect 闭包捕获过期值
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const selectedProviderRef = useRef(selectedProvider)
  selectedProviderRef.current = selectedProvider
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel

  // 加载 providers
  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // P2-7 修复: 原来 loadModelsFor 在 useEffect 之后声明 (const TDZ),
  // useEffect 运行时抛 ReferenceError, 把整个 ChatPage 抹黑。提前到 useCallback。
  const loadModelsFor = useCallback(
    async (providerId: string, force = false): Promise<ModelInfo[]> => {
      // 使用 ref 缓存避免同一会话内重复请求，但 force=true 时跳过缓存
      if (modelsRef.current[providerId] && !force) return modelsRef.current[providerId]
      setLoading(true)
      try {
        const ms = await getAPI().ai.listModels(providerId)
        setModels((p) => {
          const updated = { ...p, [providerId]: ms }
          modelsRef.current = updated
          return updated
        })
        return ms
      } catch {
        return []
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    getAPI()
      .ai.listProviders()
      .then(async (data: ProviderInfo[]) => {
        if (cancelled) return

        // 显示所有有模型的 provider（不再按 hasApiKey 过滤）
        // 排除被用户隐藏的 provider
        // 这样即使没配置 API Key，用户也能看到可用的 provider 列表
        const allWithModels = data.filter((p: ProviderInfo) => p.modelCount > 0 && !p.hidden)
        const configured = allWithModels.filter((p: ProviderInfo) => p.hasApiKey)
        setProviders(allWithModels)

        console.log(
          `[ModelSelector] Total providers: ${data.length}, with models: ${allWithModels.length}, configured: ${configured.length}`,
        )

        // 如果已有选中项（chatStore 非空），加载其模型即可，不覆盖
        if (selectedProviderRef.current && selectedModelRef.current) {
          await loadModelsFor(selectedProviderRef.current)
          return
        }

        // 否则：尝试从 settings 读取保存的默认模型
        let defaultProv = ''
        let defaultModel = ''
        try {
          const settings = await getAPI().settings.get()
          defaultProv = settings.models?.defaultProvider || ''
          defaultModel = settings.models?.highQualityModel || settings.models?.defaultModel || ''
        } catch {
          /* ignore */
        }

        // 优先使用 settings 中保存的默认 provider + model
        // 然后 fallback 到第一个已配置的 provider，再 fallback 到第一个有模型的 provider
        const target =
          configured.find((p) => p.id === defaultProv) ??
          allWithModels.find((p) => p.id === defaultProv) ??
          configured[0] ??
          allWithModels[0]

        if (target) {
          const ms = await loadModelsFor(target.id)
          if (cancelled) return
          const targetModel =
            defaultModel && ms.find((m) => m.id === defaultModel) ? defaultModel : ms[0]?.id
          if (targetModel) onSelectRef.current(target.id, targetModel)
        } else {
          console.warn(
            '[ModelSelector] No providers available at all — getProviders() may be empty',
          )
        }
      })
      .catch((err) => {
        console.error('[ModelSelector] Failed to load providers:', err)
        toast.error('加载 Provider 列表失败')
      })
    return () => {
      cancelled = true
    }
  }, [loadModelsFor])

  const handleProviderClick = (providerId: string) => {
    loadModelsFor(providerId, true) // 每次点击都重新获取
  }

  const handleModelClick = (providerId: string, modelId: string) => {
    onSelect(providerId, modelId)
    setOpen(false)
  }

  // 当前选中的显示文本
  const currentModel = models[selectedProvider]?.find((m) => m.id === selectedModel)
  const currentProvider = providers.find((p) => p.id === selectedProvider)
  const needsApiKey = currentProvider && !currentProvider.hasApiKey
  const displayText = currentModel
    ? `${currentProvider?.name ?? selectedProvider} / ${currentModel.name}${needsApiKey ? ' (需配置 Key)' : ''}`
    : selectedModel || '选择模型...'

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-1.5
                   text-xs text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition-colors max-w-[280px] truncate"
      >
        <svg
          className="w-3.5 h-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          role="img"
          aria-label="模型"
        >
          <title>模型</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        <span className="truncate">{displayText}</span>
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          role="img"
          aria-label={open ? '收起' : '展开'}
        >
          <title>{open ? '收起' : '展开'}</title>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 w-[480px] max-h-[400px] bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600
                        rounded-xl shadow-2xl overflow-hidden z-50"
        >
          <div className="flex h-[400px]">
            {/* 左侧 Provider 列表 */}
            <div className="w-[180px] border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                Providers
              </div>
              {providers.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                  无可用 Provider
                </div>
              )}
              {providers.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => handleProviderClick(p.id)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    selectedProvider === p.id
                      ? 'bg-blue-600/20 text-blue-600 dark:text-blue-400 border-l-2 border-blue-500'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${p.hasApiKey ? 'bg-green-400' : 'bg-amber-400'}`}
                    />
                    <span className="truncate">{p.name}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-3.5">
                    {p.modelCount} models{!p.hasApiKey ? ' · 未配置' : ''}
                  </span>
                </button>
              ))}
            </div>

            {/* 右侧 Model 列表 */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                Models
              </div>
              {loading ? (
                <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">
                  加载中...
                </div>
              ) : selectedProvider && models[selectedProvider] ? (
                models[selectedProvider].map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => handleModelClick(selectedProvider, m.id)}
                    className={`w-full text-left px-3 py-2 transition-colors border-b border-gray-100 dark:border-gray-700/50 ${
                      selectedModel === m.id
                        ? 'bg-blue-600/20 text-blue-600 dark:text-blue-400'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{m.name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {m.supportsReasoning && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-500 dark:text-blue-400 px-1 rounded">
                            R
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                          {(m.contextWindow / 1000).toFixed(0)}K
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                        {m.api}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        ${((m.costPerInputToken + m.costPerOutputToken) * 1_000_000).toFixed(2)}/M
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">
                  选择一个 Provider 查看模型
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
