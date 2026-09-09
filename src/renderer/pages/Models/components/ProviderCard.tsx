// =============================================================
// ProviderCard — 单个 Provider 卡片(展开/折叠 + API Key 管理 + 模型列表)
// 从 ModelsPage.tsx 抽出。逻辑零修改(逐行对照搬迁)。
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { memo, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { tr, useT } from '../../../i18n'
import { btnStyle, CARD_BASE, cn, formatDateTime, INPUT_BASE } from '../../../lib/ui-utils'
import type { ProviderTestState } from '../hooks/useModelsData'
import { ModelRow } from './ModelRow'

// 空表单常量(供 ModelRow 非编辑行传参用,避免每次 render 新建对象导致 memo 失效)
const EMPTY_EDIT_FORM: Record<string, string> = {}

/** kind → 染色(info/testing 为中性色 — 旧按子串判定的'测试中显红'缺陷顺带修复) */
const TEST_TONE: Record<ProviderTestState['kind'], string> = {
  ok: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-gray-500 dark:text-gray-400',
  testing: 'text-gray-500 dark:text-gray-400',
}

interface ProviderCardProps {
  provider: ProviderInfo
  expanded: boolean
  models: ModelInfo[]
  modelsLoading: boolean
  apiKeyInput: string
  testResult?: ProviderTestState
  onExpand: (providerId: string) => void
  onApiKeyChange: (providerId: string, value: string) => void
  onTest: (providerId: string) => void
  onDeleteKey: (providerId: string) => void
  onOAuthLogin?: (providerId: string) => void
  onRefreshModels?: (providerId: string) => void
  onHideProvider?: (providerId: string) => void
  onAddCustomModel?: (providerId: string, modelId: string) => void
  onUpdateCustomModel?: (
    providerId: string,
    modelId: string,
    updates: Record<string, unknown>,
  ) => void
  onDeleteCustomModel?: (providerId: string, modelId: string) => void
  refreshTime?: number
}

export const ProviderCard = memo(function ProviderCard({
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
  const { t } = useT()
  const p = provider
  const [customModelInput, setCustomModelInput] = useState('')
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})

  return (
    <div
      className={cn(
        CARD_BASE,
        'bg-gray-50 dark:bg-surface-elevated transition-colors',
        expanded ? 'border-blue-500/50' : '',
      )}
    >
      {/* 头部 — 点击展开 */}
      <button
        type="button"
        onClick={() => onExpand(p.id)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors rounded-t-xl"
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full ${p.hasApiKey ? 'bg-green-400' : 'bg-gray-400 dark:bg-gray-500'}`}
          />
          <h3 className="font-semibold text-base">{p.name}</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{p.id}</span>
          {p.hasApiKey && (
            <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
              {t('page.models.provider.configured')}
            </span>
          )}
          {p.hasFreeModels && (
            <span className="text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
              {t('page.models.provider.hasFreeModels')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {tr('page.models.provider.modelCount', { count: p.modelCount })}
          </span>
          <svg
            className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            role="img"
            aria-label={
              expanded ? t('page.models.provider.collapse') : t('page.models.provider.expand')
            }
          >
            <title>
              {expanded ? t('page.models.provider.collapse') : t('page.models.provider.expand')}
            </title>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-200 dark:border-white/[0.06] pt-4 space-y-4">
          {/* API Key 管理 */}
          <div className="space-y-2">
            <label
              htmlFor={`apikey-${p.id}`}
              className="text-xs text-gray-500 dark:text-gray-400 font-medium"
            >
              API Key
            </label>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">
              {t('page.models.provider.apiKeyHint')}
            </p>
            <div className="flex gap-2 items-center">
              <input
                id={`apikey-${p.id}`}
                type="password"
                value={apiKeyInput}
                onChange={(e) => onApiKeyChange(p.id, e.target.value)}
                placeholder={
                  p.hasApiKey
                    ? t('page.models.provider.apiKeySaved')
                    : t('page.models.provider.apiKeyPlaceholder')
                }
                className={cn(INPUT_BASE, 'flex-1')}
              />
              <button
                type="button"
                onClick={() => onTest(p.id)}
                className={cn(btnStyle('primary'), 'whitespace-nowrap')}
              >
                {t('page.models.provider.testConn')}
              </button>
              {p.hasApiKey && (
                <button
                  type="button"
                  onClick={() => onDeleteKey(p.id)}
                  className="bg-red-600/20 hover:bg-red-600/40 text-red-500 dark:text-red-400 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
                >
                  {t('page.models.provider.delete')}
                </button>
              )}
              {p.supportsOAuth && (
                <button
                  type="button"
                  onClick={() => onOAuthLogin?.(p.id)}
                  className="bg-gray-200 hover:bg-gray-300 dark:bg-surface-elevated dark:hover:bg-white/[0.08] px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
                  title={t('page.models.provider.oauthTitle')}
                >
                  {t('page.models.provider.oauthLogin')}
                </button>
              )}
            </div>
            {testResult && (
              <div className={`text-xs ${TEST_TONE[testResult.kind]}`}>
                {tr(testResult.key, testResult.vars ?? {})}
              </div>
            )}
          </div>

          {/* Provider 操作按钮 */}
          <div className="flex gap-2 items-center flex-wrap">
            {p.hasApiKey && onRefreshModels && (
              <button
                type="button"
                onClick={() => onRefreshModels?.(p.id)}
                className={cn(
                  btnStyle('secondary'),
                  'text-xs bg-green-600/20 hover:bg-green-600/40 text-green-500 dark:text-green-400',
                )}
              >
                {t('page.models.provider.refreshModels')}
              </button>
            )}
            {onHideProvider && (
              <button
                type="button"
                onClick={() => onHideProvider?.(p.id)}
                className={cn(btnStyle('secondary'), 'text-xs')}
              >
                {t('page.models.provider.hideProvider')}
              </button>
            )}
            {refreshTime !== undefined && refreshTime > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {t('page.models.provider.lastRefresh', '最近刷新')}: {formatDateTime(refreshTime)}
              </span>
            )}
          </div>

          {/* 模型列表 */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {t('page.models.provider.modelList')}
            </div>
            {modelsLoading ? (
              <div className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
                {t('page.models.provider.loadingModels')}
              </div>
            ) : models.length === 0 ? (
              <EmptyState icon="📦" title={t('page.models.provider.noModels')} className="py-3" />
            ) : (
              <div className="bg-gray-100 dark:bg-surface-tertiary rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-white/[0.06] text-gray-500 dark:text-gray-400">
                      <th className="text-left px-3 py-2 font-medium">
                        {t('page.models.provider.thModel')}
                      </th>
                      <th className="text-left px-3 py-2 font-medium">API</th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('page.models.provider.thContext')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('page.models.provider.thMaxOutput')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('page.models.provider.thInputCost')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('page.models.provider.thOutputCost')}
                      </th>
                      <th className="text-center px-3 py-2 font-medium">
                        {t('page.models.provider.thReasoning')}
                      </th>
                      {(onUpdateCustomModel || onDeleteCustomModel) && (
                        <th className="text-center px-3 py-2 font-medium w-20">
                          {t('page.models.provider.thActions')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <ModelRow
                        key={m.id}
                        model={m}
                        isEditing={editingModelId === m.id}
                        editForm={editingModelId === m.id ? editForm : EMPTY_EDIT_FORM}
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
                            onUpdateCustomModel?.(p.id, m.id, updates)
                          }
                          setEditingModelId(null)
                        }}
                        onEditFormChange={setEditForm}
                        onDelete={
                          onDeleteCustomModel ? () => onDeleteCustomModel?.(p.id, m.id) : undefined
                        }
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
                      onAddCustomModel?.(p.id, customModelInput.trim())
                      setCustomModelInput('')
                    }
                  }}
                  placeholder={t('page.models.provider.customModelPlaceholder')}
                  className={cn(INPUT_BASE, 'flex-1 text-xs px-3 py-1.5')}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customModelInput.trim()) {
                      onAddCustomModel?.(p.id, customModelInput.trim())
                      setCustomModelInput('')
                    }
                  }}
                  className={btnStyle('primary')}
                >
                  {t('page.models.provider.addModel')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
