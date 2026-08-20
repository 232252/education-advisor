// =============================================================
// Pi AI — Provider 模型列表获取(静态 + keyless 本地 + 在线 + 自定义 合并)
// 从 pi-ai-service.ts fetchProviderModels 下沉(纯重构,行为零变化):
//   OnlineModelsFetcher 实例由编排层持有并以参数注入(保持单例语义)。
// =============================================================

import { getEnvApiKey } from '@earendil-works/pi-ai/compat'
import type { ModelInfo } from '@shared/types'
import { keystoreService } from '../keystore-service'
// KEYLESS_PROVIDERS 从 ollama/constants 导入;ollamaService 在使用处动态导入
// (ollama-service → detection 顶层 import electron,避免把 electron 拉进模块加载链)
import { KEYLESS_PROVIDERS } from '../ollama/constants'
import { dedupeModels } from '../pi-ai-helpers'
import { settingsService } from '../settings-service'
import type { OnlineModelsFetcher } from './model-fetch'
import {
  buildCustomModelInfos,
  buildOllamaModel,
  buildStaticModelInfos,
  safeGetModels,
} from './model-utils'

/**
 * 列出指定 Provider 的所有模型（综合静态 + keyless 本地 + 在线获取 + 自定义）
 * - OpenAI 兼容 API: 调用 {baseUrl}/models
 * - Anthropic 兼容 API: 暂返回静态列表
 * - 合并用户自定义模型
 */
export async function fetchProviderModels(
  providerId: string,
  onlineFetcher: OnlineModelsFetcher,
  baseUrl?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  const models = safeGetModels(providerId)
  const settings = settingsService.getSettings()
  const customModels = settings.models.customModels?.[providerId] ?? []

  // P0-1 修复: ollama 等本地 keyless provider 不在 pi-ai 静态注册表,
  // safeGetModels 恒返回 [] → 此前合并结果恒为空(但 listProviders 显示真实 modelCount)。
  // 改为调 ollamaService.listModels() 拉取本地已安装模型(serve 未运行时返回 []),
  // 结果经 listModels() 的 modelsCache(TTL 30s)缓存。
  let keylessInfos: ModelInfo[] = []
  if (KEYLESS_PROVIDERS.has(providerId)) {
    // 动态导入 ollamaService(见文件头注释)
    const { ollamaService } = await import('../ollama-service')
    const installed = await ollamaService.listModels()
    keylessInfos = buildStaticModelInfos(installed.map((m) => buildOllamaModel(m.name)))
  }

  // 尝试在线获取模型列表（任何有 baseUrl + apiKey 的 provider 都尝试）
  let onlineModels: ModelInfo[] = []

  if (models.length > 0) {
    const sampleModel = models[0]
    const resolvedBaseUrl = baseUrl ?? sampleModel.baseUrl
    const resolvedApiKey =
      apiKey ?? keystoreService.getApiKey(providerId) ?? getEnvApiKey(providerId)

    // 本地/keyless provider(如 ollama)不需要 apiKey,只要 baseUrl 就能查模型
    const isKeyless = KEYLESS_PROVIDERS.has(providerId)
    if (resolvedBaseUrl && (resolvedApiKey || isKeyless)) {
      // M-5 修复: 使用 in-flight Promise 去重并发调用
      // 多个并发 fetchProviderModels 会复用同一个在线获取 Promise
      onlineModels = await onlineFetcher.fetchOnlineModels(
        providerId,
        resolvedBaseUrl,
        resolvedApiKey,
        models,
        sampleModel,
      )
    }
  }

  // 合并：静态模型 + keyless 本地模型 + 在线模型 + 自定义模型（去重）
  const staticInfos = buildStaticModelInfos(models)
  const customInfos = buildCustomModelInfos(providerId, customModels, baseUrl)

  return dedupeModels([...staticInfos, ...keylessInfos, ...onlineModels, ...customInfos])
}
