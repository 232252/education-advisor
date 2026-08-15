// =============================================================
// ProviderGroup — Provider 分组区块(标题 + ProviderCard 列表)
// 结构自 ModelsPage.tsx 逐字搬移(已配置/未配置两组共用,
// 仅标题文案与标题色类不同,由 props 传入)
// =============================================================

import type { ModelInfo, ProviderInfo } from '@shared/types'
import { ProviderCard } from './ProviderCard'

const EMPTY_MODELS: ModelInfo[] = []

interface ProviderGroupProps {
  /** 分组标题文案,例 "已配置 (3)" */
  title: string
  /** 标题色类(已配置绿/未配置灰) */
  titleClassName: string
  providers: ProviderInfo[]
  expandedProvider: string | null
  modelsMap: Record<string, ModelInfo[]>
  modelsLoading: Record<string, boolean>
  apiKeyInputs: Record<string, string>
  testResults: Record<string, string>
  refreshTime: Record<string, number>
  onExpand: (providerId: string) => void
  onApiKeyChange: (providerId: string, value: string) => void
  onTest: (providerId: string) => void
  onDeleteKey: (providerId: string) => void
  onOAuthLogin: (providerId: string) => void
  onRefreshModels: (providerId: string) => void
  onHideProvider: (providerId: string) => void
  onAddCustomModel: (providerId: string, modelId: string) => void
  onUpdateCustomModel: (
    providerId: string,
    modelId: string,
    updates: Record<string, unknown>,
  ) => void
  onDeleteCustomModel: (providerId: string, modelId: string) => void
}

export function ProviderGroup({
  title,
  titleClassName,
  providers,
  expandedProvider,
  modelsMap,
  modelsLoading,
  apiKeyInputs,
  testResults,
  refreshTime,
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
}: ProviderGroupProps) {
  return (
    <div>
      <h2 className={`text-sm font-medium uppercase tracking-wider mb-3 ${titleClassName}`}>
        {title}
      </h2>
      <div className="space-y-2">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            expanded={expandedProvider === p.id}
            models={modelsMap[p.id] ?? EMPTY_MODELS}
            modelsLoading={modelsLoading[p.id] ?? false}
            apiKeyInput={apiKeyInputs[p.id] ?? ''}
            testResult={testResults[p.id]}
            onExpand={onExpand}
            onApiKeyChange={onApiKeyChange}
            onTest={onTest}
            onDeleteKey={onDeleteKey}
            onOAuthLogin={onOAuthLogin}
            onRefreshModels={onRefreshModels}
            onHideProvider={onHideProvider}
            onAddCustomModel={onAddCustomModel}
            onUpdateCustomModel={onUpdateCustomModel}
            onDeleteCustomModel={onDeleteCustomModel}
            refreshTime={refreshTime[p.id] ?? 0}
          />
        ))}
      </div>
    </div>
  )
}
