// =============================================================
// DefaultModelConfig — 默认模型配置组件
// 选择默认 Provider / 高质量模型 / 低成本模型。
// 从 ModelsPage.tsx 抽出 (Phase 2.4/3, Task 19)。
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

// 格式化 token 成本（美元/百万 token）
function formatCost(costPerToken: number): string {
  if (costPerToken === 0) return '免费'
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`
  return `$${perMillion.toFixed(2)}/M`
}

export interface DefaultModelConfigProps {
  providers: ProviderInfo[]
  modelsMap: Record<string, ModelInfo[]>
  modelsLoading: Record<string, boolean>
  onRefreshModels: (providerId: string) => Promise<void>
}

export const DefaultModelConfig = memo(function DefaultModelConfig({
  providers,
  modelsMap,
  modelsLoading,
  onRefreshModels,
}: DefaultModelConfigProps) {
  const { t } = useT()
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: guarded by ref, runs only once; t is stable
  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true
    const loadSettings = async () => {
      try {
        const settings = await getAPI().settings.get()
        // UI-2 修复: 用可选链兜底,防止后端 settings.get() 在迁移/升级后返回
        // 缺少嵌套子对象(例如 models 整体缺失)导致白屏崩溃。
        const prov = settings?.models?.defaultProvider || ''
        setDefaultProvider(prov)
        setHighQualityModel(settings?.models?.highQualityModel || '')
        setLowCostModel(settings?.models?.lowCostModel || '')
        // loadProviders 已批量加载所有 configured provider 的模型，不再重复请求
      } catch (err) {
        console.error('[DefaultModelConfig] Failed to load settings:', err)
        toast.error(t('toast.models.loadDefaultFailed'))
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
    <div className="bg-gray-50 dark:bg-surface-elevated border border-gray-200 dark:border-white/[0.06] rounded-xl p-5">
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
            className={cn(INPUT_BASE, 'w-80')}
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
                className={btnStyle('secondary')}
                aria-label="刷新模型列表"
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
                  className="bg-white dark:bg-surface-tertiary border border-gray-300 dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm w-80
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow disabled:opacity-50"
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
                  className={cn(INPUT_BASE, 'text-xs w-80')}
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
                  className="bg-white dark:bg-surface-tertiary border border-gray-300 dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm w-80
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow disabled:opacity-50"
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
                  className={cn(INPUT_BASE, 'text-xs w-80')}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
})
