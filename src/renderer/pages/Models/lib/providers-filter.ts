// =============================================================
// providers-filter — Provider 过滤/分组纯函数
// 谓词自 ModelsPage.tsx 逐字搬移,行为不变
// =============================================================

import type { ProviderInfo } from '@shared/types'

/** 过滤有模型的 Provider: 搜索匹配(name/id, 不区分大小写) + 未隐藏 */
export function getVisibleProviders(providers: ProviderInfo[], searchTerm: string): ProviderInfo[] {
  return (
    searchTerm
      ? providers.filter(
          (p) =>
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.id.toLowerCase().includes(searchTerm.toLowerCase()),
        )
      : providers
  ).filter((p) => !p.hidden)
}

/** 已隐藏(黑名单)的 Provider */
export function getHiddenProviders(providers: ProviderInfo[]): ProviderInfo[] {
  return providers.filter((p) => p.hidden)
}

/** 按有/无 API Key 分组 */
export function partitionByApiKey(visibleProviders: ProviderInfo[]): {
  configuredProviders: ProviderInfo[]
  unconfiguredProviders: ProviderInfo[]
} {
  return {
    configuredProviders: visibleProviders.filter((p) => p.hasApiKey),
    unconfiguredProviders: visibleProviders.filter((p) => !p.hasApiKey),
  }
}
