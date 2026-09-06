// =============================================================
// DefaultModelConfig — 默认模型配置组件
// 选择默认 Provider / 高质量模型 / 低成本模型。
// 从 ModelsPage.tsx 抽出 (Phase 2.4/3, Task 19)。
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { formatCost } from '../lib/format'

// 格式化 token 成本（美元/百万 token）

interface DefaultModelConfigProps {
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
      setSaveToastAuto('ok', 2000)
    } catch (err) {
      console.error(`[DefaultModelConfig] Failed to save ${path}:`, err)
      setSaveToastAuto('error', 3000)
      toast.error(tr('page.models.default.saveFailedPath', { path }))
    }
  }

  // --- Handlers ---
  // HQ/LQ 双槽位处理器同构,由工厂生成(选择即保存;自定义 ID 提交 = 保存 + 加入 customModels)

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

  const makeSlotHandlers = (
    path: string,
    setSaved: (v: string) => void,
    setOverride: (v: string | null) => void,
  ) => ({
    onSelect: (value: string) => {
      setSaved(value)
      setOverride(null)
      saveSetting(path, value)
    },
    commitCustom: async (override: string | null) => {
      const value = (override ?? '').trim()
      if (value && defaultProvider) {
        setSaved(value)
        saveSetting(path, value)
        // 同时添加到 customModels 列表，让模型选择器可见
        try {
          await getAPI().ai.addCustomModel({
            providerId: defaultProvider,
            modelId: value,
            name: value,
          })
          onRefreshModels(defaultProvider)
        } catch (err) {
          console.warn(`[DefaultModelConfig] Failed to add custom model (${path}):`, err)
        }
      }
      setOverride(null)
    },
  })

  const hqHandlers = makeSlotHandlers(
    'models.highQualityModel',
    setHighQualityModel,
    setCustomHQOverride,
  )
  const lqHandlers = makeSlotHandlers('models.lowCostModel', setLowCostModel, setCustomLQOverride)

  const handleRefresh = async () => {
    if (!defaultProvider) return
    setRefreshing(true)
    try {
      await onRefreshModels(defaultProvider)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="bg-gray-50 dark:bg-surface-elevated border border-gray-200 dark:border-white/[0.06] rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg">{t('page.models.default.title', '默认模型配置')}</h2>
        {saveToast && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full transition-opacity ${
              saveToast === 'ok'
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-red-500/20 text-red-600 dark:text-red-400'
            }`}
          >
            {saveToast === 'ok'
              ? t('page.models.default.saved')
              : t('page.models.default.saveFailed')}
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* ---- Default Provider ---- */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {t('page.models.default.provider', '默认 Provider')}
          </span>
          <select
            value={defaultProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className={cn(INPUT_BASE, 'w-80')}
          >
            <option value="">{t('common.select', '请选择...')}</option>
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
                {isLoadingModels
                  ? t('page.models.provider.loadingModels')
                  : tr('page.models.default.modelsAvailable', { count: currentModels.length })}
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || isLoadingModels}
                className={btnStyle('secondary')}
                aria-label={t('page.models.default.refresh', '刷新模型列表')}
              >
                {refreshing || isLoadingModels
                  ? t('page.models.default.refreshing')
                  : t('page.models.default.refreshList')}
              </button>
            </div>

            {/* ---- High Quality / Low Cost Model 双槽位(同构 UI 收口至 ModelSlotField) ---- */}
            <ModelSlotField
              savedModel={highQualityModel}
              override={customHQOverride}
              setOverride={setCustomHQOverride}
              onSelect={hqHandlers.onSelect}
              commitCustom={hqHandlers.commitCustom}
              currentModels={currentModels}
              label={t('page.models.default.highQuality', '高质量模型')}
              placeholder={t('page.models.default.hqPlaceholder', '例如 gpt-4-turbo-preview')}
              customIdLabel={t('page.models.default.customIdLabel', '或输入自定义模型 ID')}
            />

            <ModelSlotField
              savedModel={lowCostModel}
              override={customLQOverride}
              setOverride={setCustomLQOverride}
              onSelect={lqHandlers.onSelect}
              commitCustom={lqHandlers.commitCustom}
              currentModels={currentModels}
              label={t('page.models.default.lowCost', '低成本模型')}
              placeholder={t('page.models.default.lqPlaceholder', '例如 gpt-3.5-turbo')}
              customIdLabel={t('page.models.default.customIdLabel', '或输入自定义模型 ID')}
            />
          </>
        )}
      </div>
    </div>
  )
})

interface ModelSlotFieldProps {
  /** 已保存的模型 ID;在列表内走下拉回显,不在列表内走自定义输入回显 */
  savedModel: string
  /** 自定义输入的编辑态;null = 未编辑 */
  override: string | null
  setOverride: (v: string | null) => void
  onSelect: (value: string) => void
  commitCustom: (override: string | null) => void
  currentModels: ModelInfo[]
  label: string
  placeholder: string
  customIdLabel: string
}

/** 单个默认模型槽位: 成本显示 + 模型下拉 + 自定义模型 ID 输入(HQ/LQ 同构) */
function ModelSlotField({
  savedModel,
  override,
  setOverride,
  onSelect,
  commitCustom,
  currentModels,
  label,
  placeholder,
  customIdLabel,
}: ModelSlotFieldProps) {
  const inList = savedModel ? currentModels.some((m) => m.id === savedModel) : false
  const dropdownValue = inList ? savedModel : ''
  const customValue = override !== null ? override : !inList ? savedModel : ''
  const modelInfo = currentModels.find((m) => m.id === savedModel)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
          {modelInfo && (
            <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">
              输入 {formatCost(modelInfo.costPerInputToken)} / 输出{' '}
              {formatCost(modelInfo.costPerOutputToken)}
            </span>
          )}
        </div>
        <select
          value={dropdownValue}
          onChange={(e) => onSelect(e.target.value)}
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
        <span className="text-xs text-gray-500 dark:text-gray-500">{customIdLabel}</span>
        <input
          type="text"
          value={customValue}
          onChange={(e) => setOverride(e.target.value)}
          onFocus={() => {
            // Start editing: if override is null, initialize with current display value
            if (override === null && !inList && savedModel) {
              setOverride(savedModel)
            }
          }}
          onBlur={() => commitCustom(override)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitCustom(override)
              e.currentTarget.blur()
            }
          }}
          placeholder={placeholder}
          className={cn(INPUT_BASE, 'text-xs w-80')}
        />
      </div>
    </div>
  )
}
