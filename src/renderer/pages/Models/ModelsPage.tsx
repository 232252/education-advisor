// =============================================================
// 模型管理中心页面 (编排层)
// 展示 Provider 列表 → 展开查看模型详情 → API Key 管理
// 数据/动作: hooks/useModelsData.ts
// UI 块: components/ProviderGroup / HiddenProviderList
// =============================================================

import { Loader2 } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
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
          <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title="加载中..." />
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
                onDeleteKey={handleDeleteApiKey}
                onOAuthLogin={handleOAuthLogin}
                onRefreshModels={refreshModels}
                onHideProvider={handleHideProvider}
                onAddCustomModel={handleAddCustomModel}
                onUpdateCustomModel={handleUpdateCustomModel}
                onDeleteCustomModel={handleDeleteCustomModel}
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
                onDeleteKey={handleDeleteApiKey}
                onOAuthLogin={handleOAuthLogin}
                onRefreshModels={refreshModels}
                onHideProvider={handleHideProvider}
                onAddCustomModel={handleAddCustomModel}
                onUpdateCustomModel={handleUpdateCustomModel}
                onDeleteCustomModel={handleDeleteCustomModel}
              />
            )}

            {/* 已隐藏的 Providers */}
            {hiddenProviders.length > 0 && (
              <HiddenProviderList providers={hiddenProviders} onUnhide={handleUnhideProvider} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
