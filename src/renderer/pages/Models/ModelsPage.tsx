// =============================================================
// 模型管理中心页面 (编排层)
// 展示 Provider 列表 → 展开查看模型详情 → API Key 管理
// 数据/动作: hooks/useModelsData.ts
// UI 块: components/ProviderGroup / HiddenProviderList
// =============================================================

import { useCallback, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageHeader } from '../../components/PageHeader'
import { CardSkeleton } from '../../components/Skeleton'
import { useT } from '../../i18n'
import { btnStyle, cn, INPUT_BASE } from '../../lib/ui-utils'
import { DefaultModelConfig } from './components/DefaultModelConfig'
import { HiddenProviderList } from './components/HiddenProviderList'
import { ProviderGroup } from './components/ProviderGroup'
import { useModelsData } from './hooks/useModelsData'
import { LocalModelsSection } from './LocalModelsSection'

export function ModelsPage() {
  const { t } = useT()
  const {
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
  } = useModelsData()

  // M3 修复: 删除 API Key / 删除自定义模型属危险操作,先经 ConfirmDialog 确认再执行
  type PendingDelete =
    | { type: 'apiKey'; providerId: string }
    | { type: 'customModel'; providerId: string; modelId: string }
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const confirmDeleteApiKey = useCallback(
    (providerId: string) => setPendingDelete({ type: 'apiKey', providerId }),
    [],
  )
  const confirmDeleteCustomModel = useCallback(
    (providerId: string, modelId: string) =>
      setPendingDelete({ type: 'customModel', providerId, modelId }),
    [],
  )
  const executePendingDelete = useCallback(() => {
    if (!pendingDelete) return
    if (pendingDelete.type === 'apiKey') {
      handleDeleteApiKey(pendingDelete.providerId)
    } else {
      handleDeleteCustomModel(pendingDelete.providerId, pendingDelete.modelId)
    }
    setPendingDelete(null)
  }, [pendingDelete, handleDeleteApiKey, handleDeleteCustomModel])

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
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素，不会重排序
              <CardSkeleton key={`provider-${i}`} />
            ))}
          </div>
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
              <ProviderGroup
                title={`已配置 (${configuredProviders.length})`}
                titleClassName="text-green-500 dark:text-green-400"
                providers={configuredProviders}
                expandedProvider={expandedProvider}
                modelsMap={modelsMap}
                modelsLoading={modelsLoading}
                apiKeyInputs={apiKeyInputs}
                testResults={testResults}
                refreshTime={refreshTime}
                onExpand={handleExpand}
                onApiKeyChange={handleApiKeyChange}
                onTest={handleTestConnection}
                onDeleteKey={confirmDeleteApiKey}
                onOAuthLogin={handleOAuthLogin}
                onRefreshModels={refreshModels}
                onHideProvider={handleHideProvider}
                onAddCustomModel={handleAddCustomModel}
                onUpdateCustomModel={handleUpdateCustomModel}
                onDeleteCustomModel={confirmDeleteCustomModel}
              />
            )}

            {/* 未配置的 Providers */}
            {unconfiguredProviders.length > 0 && (
              <ProviderGroup
                title={`未配置 (${unconfiguredProviders.length})`}
                titleClassName="text-gray-500 dark:text-gray-400"
                providers={unconfiguredProviders}
                expandedProvider={expandedProvider}
                modelsMap={modelsMap}
                modelsLoading={modelsLoading}
                apiKeyInputs={apiKeyInputs}
                testResults={testResults}
                refreshTime={refreshTime}
                onExpand={handleExpand}
                onApiKeyChange={handleApiKeyChange}
                onTest={handleTestConnection}
                onDeleteKey={confirmDeleteApiKey}
                onOAuthLogin={handleOAuthLogin}
                onRefreshModels={refreshModels}
                onHideProvider={handleHideProvider}
                onAddCustomModel={handleAddCustomModel}
                onUpdateCustomModel={handleUpdateCustomModel}
                onDeleteCustomModel={confirmDeleteCustomModel}
              />
            )}

            {/* 已隐藏的 Providers */}
            {hiddenProviders.length > 0 && (
              <HiddenProviderList providers={hiddenProviders} onUnhide={handleUnhideProvider} />
            )}
          </div>
        )}
      </div>

      {/* M3: 危险删除操作确认框 */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={t('page.models.confirmDeleteTitle', '确认删除')}
        message={
          pendingDelete?.type === 'apiKey'
            ? `${t('page.models.confirmDeleteApiKey', '将删除该 Provider 的 API Key，删除后需重新配置。')} (${pendingDelete.providerId})`
            : pendingDelete?.type === 'customModel'
              ? `${t('page.models.confirmDeleteModel', '将删除自定义模型，删除后需重新添加。')} (${pendingDelete.modelId})`
              : ''
        }
        variant="danger"
        onConfirm={executePendingDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
