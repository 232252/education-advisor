// =============================================================
// Pi AI — 在线模型获取: {baseUrl}/models 拉取 + 失败 TTL 缓存 + in-flight 去重
// 从 pi-ai-service.ts 拆出。逻辑零修改(逐行对照搬迁)。
//
// 状态搬移说明:
//   failedOnlineFetch / fetchModelsInFlight / FAILED_FETCH_TTL_MS
//   原为 PiAIService 实例字段(单例),现由本类持有,
//   PiAIService 通过唯一实例委托,行为不变。
// =============================================================

import type { Api, Model } from '@earendil-works/pi-ai/compat'
import type { ModelInfo } from '@shared/types'

export class OnlineModelsFetcher {
  /**
   * 缓存在线模型获取失败的 provider，避免重复请求已知不支持 /models 端点的 provider
   * OPT-1 优化: 改为 Map<providerId, expireAt> 带 TTL(5 分钟),
   * 防止瞬时网络抖动导致 provider 被永久拉黑(需重启 app 才能重试)
   */
  private failedOnlineFetch = new Map<string, number>()
  /** OPT-1: 失败缓存 TTL — 5 分钟后允许重试 */
  private static readonly FAILED_FETCH_TTL_MS = 5 * 60 * 1000
  /**
   * M-5 修复: 正在进行中的在线模型获取 Promise,按 providerId 去重。
   * 多个并发 fetchProviderModels 调用同一 provider 时复用同一个 in-flight Promise,
   * 避免竞态:多个调用同时跳过 failedOnlineFetch 检查并重复发起 fetch。
   */
  private fetchModelsInFlight = new Map<string, Promise<ModelInfo[]>>()

  /**
   * M-5 修复: 内部方法 — 实际发起在线模型获取请求。
   * 使用 in-flight Promise 去重:多个并发调用同一 providerId 时复用同一个 Promise,
   * 避免竞态(多个调用同时跳过 failedOnlineFetch 检查并重复发起 fetch)。
   */
  async fetchOnlineModels(
    providerId: string,
    resolvedBaseUrl: string,
    resolvedApiKey: string | undefined,
    models: Model<Api>[],
    sampleModel: Model<Api>,
  ): Promise<ModelInfo[]> {
    // 已知失败的 provider 直接跳过 (OPT-1: 带 TTL,过期后允许重试)
    const failedExpiry = this.failedOnlineFetch.get(providerId)
    if (failedExpiry && failedExpiry > Date.now()) {
      console.log(
        `[PiAI] Skipping online model fetch for ${providerId} (previously failed, retry in ${Math.ceil((failedExpiry - Date.now()) / 1000)}s)`,
      )
      return []
    }
    // OPT-1: 过期条目清理
    if (failedExpiry) {
      this.failedOnlineFetch.delete(providerId)
    }
    // M-5 修复: 如果已有 in-flight Promise,复用它
    const existing = this.fetchModelsInFlight.get(providerId)
    if (existing) {
      console.log(`[PiAI] Reusing in-flight online model fetch for ${providerId}`)
      return existing
    }
    // 创建新的 in-flight Promise
    const promise = this.doFetchOnlineModels(
      providerId,
      resolvedBaseUrl,
      resolvedApiKey,
      models,
      sampleModel,
    ).finally(() => {
      this.fetchModelsInFlight.delete(providerId)
    })
    this.fetchModelsInFlight.set(providerId, promise)
    return promise
  }

  /** M-5 修复: 实际执行 fetch 的内部方法 */
  private async doFetchOnlineModels(
    providerId: string,
    resolvedBaseUrl: string,
    resolvedApiKey: string | undefined,
    models: Model<Api>[],
    sampleModel: Model<Api>,
  ): Promise<ModelInfo[]> {
    try {
      const modelsUrl = `${resolvedBaseUrl.replace(/\/+$/, '')}/models`
      const response = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${resolvedApiKey}` },
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        const data = (await response.json()) as {
          data?: Array<{ id: string; object?: string }>
        }
        if (data?.data && Array.isArray(data.data)) {
          const onlineModels = data.data.map((m) => {
            // H-8 修复: 不再硬编码 contextWindow: 32768 / maxOutputTokens: 4096
            // 优先从 provider 的静态模型中查找同 id 模型获取真实参数,
            // 找不到才用保守默认值
            const staticMatch = models.find((sm) => sm.id === m.id)
            return {
              id: m.id,
              name: m.id,
              providerId,
              api: sampleModel.api as string,
              contextWindow: staticMatch?.contextWindow ?? 32768,
              maxOutputTokens: staticMatch?.maxTokens ?? 4096,
              costPerInputToken: staticMatch?.cost.input ?? 0,
              costPerOutputToken: staticMatch?.cost.output ?? 0,
              costCacheRead: staticMatch?.cost.cacheRead ?? 0,
              costCacheWrite: staticMatch?.cost.cacheWrite ?? 0,
              supportsReasoning: staticMatch?.reasoning ?? false,
              baseUrl: resolvedBaseUrl,
            }
          })
          console.log(`[PiAI] Fetched ${onlineModels.length} models online from ${providerId}`)
          return onlineModels
        }
      } else {
        console.warn(
          `[PiAI] Online model fetch for ${providerId} returned ${response.status}, caching as failed`,
        )
        this.failedOnlineFetch.set(providerId, Date.now() + OnlineModelsFetcher.FAILED_FETCH_TTL_MS)
      }
    } catch (err) {
      console.warn(
        `[PiAI] Failed to fetch models online for ${providerId}:`,
        err instanceof Error ? err.message : String(err),
      )
      this.failedOnlineFetch.set(providerId, Date.now() + OnlineModelsFetcher.FAILED_FETCH_TTL_MS)
    }
    return []
  }

  /** OPT-1: API key 变更/删除后清除失败缓存,允许重新尝试在线模型获取(供编排层调用) */
  clearFailure(providerId: string): void {
    this.failedOnlineFetch.delete(providerId)
  }
}
