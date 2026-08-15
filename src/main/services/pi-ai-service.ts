// =============================================================
// Pi AI Service - 统一 LLM 接口（编排层）
// 已接入 @earendil-works/pi-ai，零改动复用 30+ Provider
//
// 实现已按职责拆分到 ./pi-ai/ 子目录（纯重构,行为零变化）:
//   - pi-ai/providers.ts    provider 常量表(OAUTH_PROVIDERS 等) + listProviders/oauthLogin
//   - pi-ai/model-utils.ts  safeGetModels/resolveModel + 静态/自定义模型 ModelInfo 映射
//   - pi-ai/model-fetch.ts  在线模型获取(失败 TTL 缓存 + in-flight 去重)
//   - pi-ai/streaming.ts    流式对话(重试/首字节超时/abort/压缩)
// 本文件保留 PiAIService 类骨架: 公共方法签名不变,委托子模块组合。
// =============================================================

import {
  type Context,
  completeSimple,
  getEnvApiKey,
  type ModelThinkingLevel,
} from '@earendil-works/pi-ai/compat'
import type { ModelInfo, ProviderInfo, StreamEvent, TestConnectionResult } from '@shared/types'
import { TtlLruCache } from './eaa-cache'
import { keystoreService } from './keystore-service'
// KEYLESS_PROVIDERS 从 ollama/constants 导入;ollamaService 在使用处动态导入
// (ollama-service → detection 顶层 import electron,避免把 electron 拉进模块加载链)
import { KEYLESS_PROVIDERS } from './ollama/constants'
import { OnlineModelsFetcher } from './pi-ai/model-fetch'
import {
  buildCustomModelInfos,
  buildOllamaModel,
  buildStaticModelInfos,
  safeGetModels,
} from './pi-ai/model-utils'
import { listProviders, oauthLogin } from './pi-ai/providers'
import { ChatStreamRunner } from './pi-ai/streaming'
import { dedupeModels, selectCheapestModel } from './pi-ai-helpers'
import { settingsService } from './settings-service'

// re-export 子模块公共 API(原定义于本文件,便于外部/测试直接导入)
export { OAUTH_KEY_URLS, OAUTH_PROVIDERS, PROVIDER_NAMES } from './pi-ai/providers'

class PiAIService {
  /**
   * R136 优化: listModels 结果缓存 (TTL 30s, 容量 32 providers)
   * Models 页展开/刷新、Chat/Agent 运行时的模型解析都调用 listModels,
   * 缓存避免反复重建 (静态 + 自定义 + 在线) 合并列表。
   * API Key / 自定义模型变更时主动失效。
   */
  private modelsCache = new TtlLruCache<ModelInfo[]>({ ttlMs: 30_000, maxEntries: 32 })
  /** 在线模型获取器(失败 TTL 缓存 + in-flight 去重状态见 pi-ai/model-fetch.ts) */
  private onlineFetcher = new OnlineModelsFetcher()
  /** 流式对话执行器(abortController 并发管理见 pi-ai/streaming.ts) */
  private streamRunner = new ChatStreamRunner()

  // ===========================================================
  // Provider 管理
  // ===========================================================

  /** 列出所有已注册的 Provider（标记黑名单而非过滤）— 委托 pi-ai/providers.ts */
  async listProviders(): Promise<ProviderInfo[]> {
    return listProviders()
  }

  /** 列出指定 Provider 的所有模型（综合静态 + 自定义 + 在线获取） */
  async listModels(providerId: string): Promise<ModelInfo[]> {
    // R136 优化: TTL 缓存,避免每次都重建合并列表
    const cached = this.modelsCache.get(providerId)
    if (cached) return cached
    const result = await this.listAllKnownModels(providerId)
    this.modelsCache.set(providerId, result)
    return result
  }

  /**
   * 从 API 在线获取模型列表
   * - OpenAI 兼容 API: 调用 {baseUrl}/models
   * - Anthropic 兼容 API: 暂返回静态列表
   * - 合并用户自定义模型
   */
  async fetchProviderModels(
    providerId: string,
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
      const { ollamaService } = await import('./ollama-service')
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
        onlineModels = await this.onlineFetcher.fetchOnlineModels(
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

  /** 综合获取所有已知模型：静态 + 自定义 + 在线 */
  async listAllKnownModels(providerId: string): Promise<ModelInfo[]> {
    return this.fetchProviderModels(providerId)
  }

  /** 添加自定义模型到指定 Provider */
  addCustomModel(
    providerId: string,
    model: {
      id: string
      name?: string
      contextWindow?: number
      maxOutputTokens?: number
      supportsReasoning?: boolean
      costPerInputToken?: number
      costPerOutputToken?: number
      api?: string
      baseUrl?: string
    },
  ): ModelInfo {
    const settings = settingsService.getSettings()
    const existing = settings.models.customModels?.[providerId] ?? []
    // 去重：如果已存在同 id 则覆盖
    const filtered = existing.filter((m) => m.id !== model.id)

    // 推断 API 类型：从该 provider 的静态模型中获取，否则默认 openai-completions
    const staticModels = safeGetModels(providerId)
    const defaultApi = staticModels.length > 0 ? staticModels[0].api : 'openai-completions'
    const defaultBaseUrl = staticModels.length > 0 ? staticModels[0].baseUrl : ''

    const api = model.api ?? defaultApi
    const baseUrl = model.baseUrl ?? defaultBaseUrl

    const entry = {
      id: model.id,
      name: model.name ?? model.id,
      contextWindow: model.contextWindow ?? 32768,
      maxOutputTokens: model.maxOutputTokens ?? 4096,
      supportsReasoning: model.supportsReasoning ?? false,
      costPerInputToken: model.costPerInputToken ?? 0,
      costPerOutputToken: model.costPerOutputToken ?? 0,
      api: api as string,
      baseUrl,
    }

    const updated = [...filtered, entry]
    settingsService.setCustomModels(providerId, updated)
    // R136: 自定义模型变更,失效 listModels 缓存
    this.modelsCache.delete(providerId)
    console.log(
      `[PiAI] Added custom model "${model.id}" to ${providerId} (total: ${updated.length})`,
    )

    return {
      id: entry.id,
      name: entry.name,
      providerId,
      api,
      contextWindow: entry.contextWindow,
      maxOutputTokens: entry.maxOutputTokens,
      costPerInputToken: entry.costPerInputToken,
      costPerOutputToken: entry.costPerOutputToken,
      costCacheRead: 0,
      costCacheWrite: 0,
      supportsReasoning: entry.supportsReasoning,
      baseUrl,
      isCustom: true,
    }
  }

  /** 从指定 Provider 移除自定义模型 */
  removeCustomModel(providerId: string, modelId: string): boolean {
    const settings = settingsService.getSettings()
    const existing = settings.models.customModels?.[providerId] ?? []
    const filtered = existing.filter((m) => m.id !== modelId)
    if (filtered.length === existing.length) return false
    settingsService.setCustomModels(providerId, filtered)
    // R136: 自定义模型变更,失效 listModels 缓存
    this.modelsCache.delete(providerId)
    console.log(`[PiAI] Removed custom model "${modelId}" from ${providerId}`)
    return true
  }

  /** 更新自定义模型属性 */
  updateCustomModel(
    providerId: string,
    modelId: string,
    updates: {
      name?: string
      contextWindow?: number
      maxOutputTokens?: number
      supportsReasoning?: boolean
      costPerInputToken?: number
      costPerOutputToken?: number
      api?: string
      baseUrl?: string
    },
  ): boolean {
    const settings = settingsService.getSettings()
    const existing = settings.models.customModels?.[providerId] ?? []
    const idx = existing.findIndex((m) => m.id === modelId)
    if (idx === -1) return false

    const current = existing[idx]
    const updated = [...existing]
    updated[idx] = {
      ...current,
      name: updates.name ?? current.name,
      contextWindow: updates.contextWindow ?? current.contextWindow,
      maxOutputTokens: updates.maxOutputTokens ?? current.maxOutputTokens,
      supportsReasoning: updates.supportsReasoning ?? current.supportsReasoning,
      costPerInputToken: updates.costPerInputToken ?? current.costPerInputToken,
      costPerOutputToken: updates.costPerOutputToken ?? current.costPerOutputToken,
      api: updates.api ?? current.api,
      baseUrl: updates.baseUrl ?? current.baseUrl,
    }
    settingsService.setCustomModels(providerId, updated)
    // R136: 自定义模型变更,失效 listModels 缓存
    this.modelsCache.delete(providerId)
    console.log(`[PiAI] Updated custom model "${modelId}" in ${providerId}:`, Object.keys(updates))
    return true
  }

  /** 按 id 去重模型列表 — 已委托到 ./pi-ai-helpers.ts dedupeModels */

  // ===========================================================
  // 连接测试
  // ===========================================================

  /** 测试 Provider 连接（发送一个最小请求验证 API Key） */
  async testConnection(
    providerId: string,
    apiKey: string,
    _baseUrl?: string,
  ): Promise<TestConnectionResult> {
    const start = Date.now()
    const models = safeGetModels(providerId)

    // R169 修复: 当调用方未显式传入 apiKey 时,回退到 keystore / 环境变量
    // 此前 testConnection('minimax-cn', '') 返回 "No API key" 即使 keystore 已存储 key,
    // 导致用户在 Models 页面点击"测试"按钮时(输入框为空)无法测试已配置的 provider
    const resolvedApiKey =
      apiKey || keystoreService.getApiKey(providerId) || getEnvApiKey(providerId)

    if (models.length === 0) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        model: '',
        error: `No models available for provider: ${providerId}`,
      }
    }

    // 选择最便宜的模型做测试
    const testModel = selectCheapestModel(models)

    if (!resolvedApiKey) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        model: testModel.id,
        error: `No API key for provider: ${providerId}`,
      }
    }

    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
      }

      const result = await completeSimple(testModel, context, {
        apiKey: resolvedApiKey,
        maxTokens: 5,
      })

      const latencyMs = Date.now() - start

      if (result.stopReason === 'error') {
        return {
          success: false,
          latencyMs,
          model: testModel.id,
          error: result.errorMessage ?? 'Unknown error',
        }
      }

      return {
        success: true,
        latencyMs,
        model: testModel.id,
      }
    } catch (err: unknown) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        model: testModel.id,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ===========================================================
  // 流式对话 — 委托 pi-ai/streaming.ts ChatStreamRunner
  // ===========================================================

  /**
   * 流式对话 - 返回异步迭代器，供 IPC handler 逐事件转发到渲染进程
   */
  async *chatStream(params: {
    providerId: string
    modelId: string
    messages: Array<{ role: string; content: string }>
    systemPrompt?: string
    thinking?: ModelThinkingLevel
    maxTokens?: number
  }): AsyncGenerator<StreamEvent> {
    yield* this.streamRunner.chatStream(params)
  }

  // ===========================================================
  // API Key 管理
  // ===========================================================

  setApiKey(providerId: string, apiKey: string) {
    keystoreService.setApiKey(providerId, apiKey)
    // OPT-1: API key 变更后清除失败缓存,允许重新尝试在线模型获取
    this.onlineFetcher.clearFailure(providerId)
    // R136: API key 变更可能影响在线模型列表,失效缓存
    this.modelsCache.delete(providerId)
  }

  deleteApiKey(providerId: string) {
    keystoreService.deleteApiKey(providerId)
    // OPT-1: API key 删除后清除失败缓存
    this.onlineFetcher.clearFailure(providerId)
    // R136: API key 删除后在线模型列表会变化,失效缓存
    this.modelsCache.delete(providerId)
  }

  getApiKey(providerId: string): string | undefined {
    return keystoreService.getApiKey(providerId) ?? getEnvApiKey(providerId)
  }

  // ===========================================================
  // 内部工具方法 — safeGetModels/resolveModel 已下沉到 pi-ai/model-utils.ts
  // ===========================================================

  // ===========================================================
  // OAuth 登录（PKCE/device-code 流程）— 委托 pi-ai/providers.ts oauthLogin
  // ===========================================================

  async oauthLogin(providerId: string): Promise<{
    success: boolean
    error?: string
    authUrl?: string
    pollInterval?: number
  }> {
    return oauthLogin(providerId)
  }

  // ===========================================================
  // 以下纯函数已迁移到 ./pi-ai-helpers.ts:
  //   - dedupeModels: 按 id 去重模型列表
  //   - selectCheapestModel: 选择成本最低的模型(用于连接测试)
  //   - mapEvent: pi-ai AssistantMessageEvent → 前端 StreamEvent
  //   - extractPartialToolCall: 从 partial AssistantMessage 提取 toolCall
  //   - isRetryableError: 判定错误是否可重试(网络/限流/5xx)
  // 这些函数无 I/O、无单例状态,可被 Vitest 直接单元测试。
  // ===========================================================

  // ===========================================================
  // 对话压缩 (Feature J)
  // 压缩逻辑已迁移到 ./compaction-helper.ts:
  //   - compactAgentMessages: LLM 摘要版(Agent + Chat 链路统一使用)
  //   - compactChatMessagesSimple: 字符串截断版(LLM 失败时的降级方案)
  // ===========================================================
}

export const piAIService = new PiAIService()
