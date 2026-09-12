// =============================================================
// providers-filter — Provider 过滤/分组纯函数
// =============================================================

import { providerSearchAliases } from '@shared/provider-labels'
import type { ProviderInfo } from '@shared/types'

function matchesSearch(provider: ProviderInfo, searchTerm: string): boolean {
  const query = searchTerm.trim().toLowerCase()
  if (!query) return true
  const haystacks = [provider.name, provider.id, ...providerSearchAliases(provider.id)]
  return haystacks.some((text) => {
    const hay = text.toLowerCase()
    return hay.includes(query) || (text.length >= 2 && query.includes(hay))
  })
}

/** 过滤有模型的 Provider: 搜索匹配(name/id/别名, 不区分大小写) + 未隐藏 */
export function getVisibleProviders(providers: ProviderInfo[], searchTerm: string): ProviderInfo[] {
  return (searchTerm ? providers.filter((p) => matchesSearch(p, searchTerm)) : providers).filter(
    (p) => !p.hidden,
  )
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
