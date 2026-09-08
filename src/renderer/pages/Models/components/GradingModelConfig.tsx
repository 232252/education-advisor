// =============================================================
// GradingModelConfig — AI 批改作业的模型选择卡片(Models 页)
// 只列出支持图像输入(视觉)的模型;未选择时跟随高质量模型。
// 写 settings.grading.{provider,model}(dotPath 已在 default-settings.json 声明)。
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { memo, useEffect, useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { formatCost } from '../lib/format'

interface GradingModelConfigProps {
  providers: ProviderInfo[]
  modelsMap: Record<string, ModelInfo[]>
  modelsLoading: Record<string, boolean>
  onRefreshModels: (providerId: string) => Promise<void>
}

export const GradingModelConfig = memo(function GradingModelConfig({
  providers,
  modelsMap,
  modelsLoading,
  onRefreshModels,
}: GradingModelConfigProps) {
  const { t } = useT()
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [saveToast, setSaveToast] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const setSaveToastAuto = useAutoDismiss<string>(setSaveToast, '', 3000)
  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true
    void (async () => {
      try {
        const settings = await getAPI().settings.get()
        setProvider(settings?.grading?.provider || '')
        setModel(settings?.grading?.model || '')
      } catch (err) {
        console.error('[GradingModelConfig] Failed to load settings:', err)
      }
    })()
  }, [])

  const configuredProviders = providers.filter((p) => p.hasApiKey)
  // 视觉模型过滤: supportsImage 由静态注册表的 input 能力映射(自定义模型无此标记)
  const visionModels = (provider ? (modelsMap[provider] ?? []) : []).filter(
    (m) => m.supportsImage === true,
  )
  const isLoadingModels = provider ? (modelsLoading[provider] ?? false) : false

  const save = async (path: string, value: string) => {
    try {
      await getAPI().settings.set(path, value)
      setSaveToastAuto('ok', 2000)
    } catch (err) {
      console.error(`[GradingModelConfig] Failed to save ${path}:`, err)
      setSaveToastAuto('error', 3000)
    }
  }

  const handleProviderChange = (value: string) => {
    setProvider(value)
    setModel('')
    void save('grading.provider', value)
    void save('grading.model', '')
    if (value) void onRefreshModels(value)
  }

  const handleModelChange = (value: string) => {
    setModel(value)
    void save('grading.model', value)
  }

  const handleRefresh = async () => {
    if (!provider) return
    setRefreshing(true)
    try {
      await onRefreshModels(provider)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="bg-gray-50 dark:bg-surface-elevated border border-gray-200 dark:border-white/[0.06] rounded-xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">
            {t('page.grading.model.title', '批改模型（AI 批改作业）')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t('page.grading.model.desc', '需要支持图像输入的视觉模型；未选择时跟随高质量模型')}
          </p>
        </div>
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

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {t('page.models.default.provider', '默认 Provider')}
          </span>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className={cn(INPUT_BASE, 'w-80')}
          >
            <option value="">{t('page.grading.model.follow', '跟随高质量模型')}</option>
            {configuredProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {provider && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-500">
                {isLoadingModels
                  ? t('page.models.provider.loadingModels')
                  : tr('page.models.default.modelsAvailable', { count: visionModels.length })}
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
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('page.grading.model.pick', '视觉模型')}
              </span>
              <select
                value={model}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={visionModels.length === 0}
                className={cn(INPUT_BASE, 'w-80')}
              >
                <option value="">{t('common.select', '请选择...')}</option>
                {visionModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {tr('page.models.default.optionCost', {
                      name: m.name,
                      in: formatCost(m.costPerInputToken),
                      out: formatCost(m.costPerOutputToken),
                    })}
                  </option>
                ))}
              </select>
            </div>
            {visionModels.length === 0 && !isLoadingModels && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t(
                  'page.grading.model.noVision',
                  '该 Provider 暂无已知视觉模型（可刷新或更换 Provider）',
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
})
