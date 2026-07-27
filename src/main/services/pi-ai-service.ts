// =============================================================
// Pi AI Service - 统一 LLM 接口
// 已接入 @earendil-works/pi-ai，零改动复用 30+ Provider
// =============================================================

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  type Api,
  type AssistantMessage,
  type Context,
  completeSimple,
  getEnvApiKey,
  getModel,
  getModels,
  getProviders,
  type Message,
  type Model,
  type ModelThinkingLevel,
  streamSimple,
  type ThinkingLevel,
} from '@earendil-works/pi-ai/compat'
import type { ModelInfo, ProviderInfo, StreamEvent, TestConnectionResult } from '../../shared/types'
import { logChat } from '../utils/logger'
import { compactAgentMessages, compactChatMessagesSimple } from './compaction-helper'
import { TtlLruCache } from './eaa-cache'
import { keystoreService } from './keystore-service'
import { KEYLESS_PROVIDERS, OLLAMA_OPENAI_BASE_URL, ollamaService } from './ollama-service'
import { dedupeModels, isRetryableError, mapEvent, selectCheapestModel } from './pi-ai-helpers'
import { settingsService } from './settings-service'

// OAuth 支持的 provider 列表
const OAUTH_PROVIDERS = new Set(['anthropic', 'github-copilot', 'openai-codex'])

// OAuth provider 的 API Key 获取页面
const OAUTH_KEY_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  'github-copilot': 'https://github.com/settings/tokens',
  'openai-codex': 'https://platform.openai.com/api-keys',
}

// Provider 显示名称映射
const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  'google-vertex': 'Google Vertex AI',
  'amazon-bedrock': 'Amazon Bedrock',
  'azure-openai-responses': 'Azure OpenAI',
  'openai-codex': 'OpenAI Codex',
  deepseek: 'DeepSeek',
  'github-copilot': 'GitHub Copilot',
  xai: 'xAI (Grok)',
  groq: 'Groq',
  cerebras: 'Cerebras',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  zai: 'Z.AI',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (中国)',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (中国)',
  huggingface: 'Hugging Face',
  fireworks: 'Fireworks AI',
  together: 'Together AI',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'kimi-coding': 'Kimi Coding',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  xiaomi: 'Xiaomi MiMo',
  'xiaomi-token-plan-cn': 'Xiaomi (中国)',
  'xiaomi-token-plan-ams': 'Xiaomi (AMS)',
  'xiaomi-token-plan-sgp': 'Xiaomi (SGP)',
}

class PiAIService {
  private abortController: AbortController | null = null
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
   * R136 优化: listModels 结果缓存 (TTL 30s, 容量 32 providers)
   * Models 页展开/刷新、Chat/Agent 运行时的模型解析都调用 listModels,
   * 缓存避免反复重建 (静态 + 自定义 + 在线) 合并列表。
   * API Key / 自定义模型变更时主动失效。
   */
  private modelsCache = new TtlLruCache<ModelInfo[]>({ ttlMs: 30_000, maxEntries: 32 })

  // ===========================================================
  // Provider 管理
  // ===========================================================

  /** 列出所有已注册的 Provider（标记黑名单而非过滤） */
  async listProviders(): Promise<ProviderInfo[]> {
    await keystoreService.ready()
    const settings = settingsService.getSettings()
    const blacklist = settings.models.providerBlacklist ?? []
    // ✅ [Settings wiring] 读取 models.enabledModels — 只在白名单里的 model 才暴露
    const enabledModels = settings.models.enabledModels ?? []
    // ✅ [Settings wiring] 读取 models.transport / cacheRetention 供调用方参考
    const transport = settings.models.transport ?? 'auto'
    const cacheRetention = settings.models.cacheRetention ?? 'short'
    console.log(
      `[PiAI] transport=${transport} cacheRetention=${cacheRetention} enabledModels=[${enabledModels.join(', ') || 'all'}]`,
    )
    const providerIds = getProviders()

    const keystoreProviders = keystoreService.listProviders()
    const envKeyProviders = providerIds.filter((id) => !!getEnvApiKey(id))
    console.log(`[PiAI] getProviders() returned ${providerIds.length} providers`)
    console.log(`[PiAI] Keystore has keys for: [${keystoreProviders.join(', ')}]`)
    console.log(`[PiAI] Env API keys found for: [${envKeyProviders.join(', ')}]`)

    const results: ProviderInfo[] = providerIds.map((id) => {
      const models = this.safeGetModels(id)
      // ✅ 应用 enabledModels 过滤:若白名单非空,只保留白名单里的 model
      const filteredModels =
        enabledModels.length > 0 ? models.filter((m) => enabledModels.includes(m.id)) : models
      const keystoreKey = keystoreService.getApiKey(id)
      const envKey = getEnvApiKey(id)
      const hasApiKey = !!(keystoreKey || envKey)
      // 检测免费模型：input + output 均 0 成本（如 zai 全系、opencode 的 *-free、kimi-coding）
      const hasFreeModels = models.some(
        (m) => (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0,
      )

      return {
        id,
        name: PROVIDER_NAMES[id] ?? id,
        supportsOAuth: OAUTH_PROVIDERS.has(id),
        hasApiKey,
        modelCount: filteredModels.length,
        hasFreeModels,
        // 若 enabledModels 把所有 model 都过滤掉了,标 disabled 提示用户
        hidden:
          blacklist.includes(id) ||
          (enabledModels.length > 0 && filteredModels.length === 0 && models.length > 0),
      }
    })

    // 注入本地 Ollama provider(如果可用)
    try {
      const ollamaAvailable = await ollamaService.detect()
      if (ollamaAvailable) {
        const serveRunning = await ollamaService.isServeRunning()
        const ollamaModels = serveRunning ? await ollamaService.listModels() : []
        results.push({
          id: 'ollama',
          name: '本地模型 (Ollama)',
          supportsOAuth: false,
          hasApiKey: true, // keyless,但标记为 true 让排序和选择逻辑正常工作
          modelCount: ollamaModels.length,
          hasFreeModels: true, // 本地模型永远免费
          hidden: false,
        })
        console.log(
          `[PiAI] Ollama provider injected: available=${ollamaAvailable} models=${ollamaModels.length}`,
        )
      }
    } catch (err) {
      console.log(`[PiAI] Ollama detection skipped: ${err}`)
    }

    // 排序：免费模型 provider 优先（让用户更容易发现 zai/opencode/kimi 等免费选项）
    results.sort((a, b) => {
      if (a.hasFreeModels !== b.hasFreeModels) return a.hasFreeModels ? -1 : 1
      if (a.hasApiKey !== b.hasApiKey) return a.hasApiKey ? -1 : 1 // 已配置的靠前
      return a.name.localeCompare(b.name)
    })

    const configured = results.filter((p) => p.hasApiKey && p.modelCount > 0)
    console.log(
      `[PiAI] Configured providers (hasApiKey && modelCount>0): ${configured.length} -> [${configured.map((p) => p.id).join(', ')}]`,
    )

    return results
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
   * M-5 修复: 内部方法 — 实际发起在线模型获取请求。
   * 使用 in-flight Promise 去重:多个并发调用同一 providerId 时复用同一个 Promise,
   * 避免竞态(多个调用同时跳过 failedOnlineFetch 检查并重复发起 fetch)。
   */
  private async fetchOnlineModels(
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
        this.failedOnlineFetch.set(providerId, Date.now() + PiAIService.FAILED_FETCH_TTL_MS)
      }
    } catch (err) {
      console.warn(
        `[PiAI] Failed to fetch models online for ${providerId}:`,
        err instanceof Error ? err.message : String(err),
      )
      this.failedOnlineFetch.set(providerId, Date.now() + PiAIService.FAILED_FETCH_TTL_MS)
    }
    return []
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
    const models = this.safeGetModels(providerId)
    const settings = settingsService.getSettings()
    const customModels = settings.models.customModels?.[providerId] ?? []

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
        onlineModels = await this.fetchOnlineModels(
          providerId,
          resolvedBaseUrl,
          resolvedApiKey,
          models,
          sampleModel,
        )
      }
    }

    // 合并：静态模型 + 在线模型 + 自定义模型（去重）
    const staticInfos = models.map((m) => ({
      id: m.id,
      name: m.name,
      providerId: m.provider,
      api: m.api,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxTokens,
      costPerInputToken: m.cost.input,
      costPerOutputToken: m.cost.output,
      costCacheRead: m.cost.cacheRead,
      costCacheWrite: m.cost.cacheWrite,
      supportsReasoning: m.reasoning,
      baseUrl: m.baseUrl,
    }))

    // 自定义模型默认值从 provider 静态模型获取
    const customDefaultModels = this.safeGetModels(providerId)
    const customDefaultApi =
      customDefaultModels.length > 0 ? customDefaultModels[0].api : 'openai-completions'
    const customDefaultBaseUrl =
      customDefaultModels.length > 0 ? customDefaultModels[0].baseUrl : ''

    const customInfos: ModelInfo[] = customModels.map((cm) => ({
      id: cm.id,
      name: cm.name,
      providerId,
      api: cm.api ?? customDefaultApi,
      contextWindow: cm.contextWindow,
      maxOutputTokens: cm.maxOutputTokens,
      costPerInputToken: cm.costPerInputToken,
      costPerOutputToken: cm.costPerOutputToken,
      costCacheRead: 0,
      costCacheWrite: 0,
      supportsReasoning: cm.supportsReasoning,
      baseUrl: cm.baseUrl ?? baseUrl ?? customDefaultBaseUrl,
      isCustom: true,
    }))

    return dedupeModels([...staticInfos, ...onlineModels, ...customInfos])
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
    const staticModels = this.safeGetModels(providerId)
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
    const models = this.safeGetModels(providerId)

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

    try {
      const context: Context = {
        messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
      }

      const result = await completeSimple(testModel, context, {
        apiKey,
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
  // 流式对话
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
    // ✅ [Settings wiring] 读取 models.retry.* 配置 (R132 修复: 前置读取,
    // 使所有 error 路径(包括 model-not-found / no-api-key / empty-messages)
    // 都能附带 retry 元信息,保证渲染端 UI 一致性)
    // 默认值:enabled=true / maxRetries=3 / baseDelayMs=1000 / providerTimeoutMs=60000
    let retryEnabled = true
    let maxRetries = 3
    let baseDelayMs = 1000
    let providerTimeoutMs = 60000
    try {
      const r = settingsService.getSettings().models?.retry
      if (r) {
        if (typeof r.enabled === 'boolean') retryEnabled = r.enabled
        if (typeof r.maxRetries === 'number' && r.maxRetries >= 0) maxRetries = r.maxRetries
        if (typeof r.baseDelayMs === 'number' && r.baseDelayMs > 0) baseDelayMs = r.baseDelayMs
        if (typeof r.providerTimeoutMs === 'number' && r.providerTimeoutMs > 0) {
          providerTimeoutMs = r.providerTimeoutMs
        }
      }
    } catch (err) {
      console.warn('[PiAI] Failed to read models.retry.* from settings:', err)
    }
    /** 构造 retry 元信息对象,附在 error 事件上供渲染端决定是否显示重试按钮 */
    const buildRetryInfo = (retryable: boolean) => ({
      enabled: retryEnabled,
      maxRetries,
      baseDelayMs,
      providerTimeoutMs,
      shouldRetry: retryable && retryEnabled && maxRetries > 0,
    })

    // 解析模型
    const model = this.resolveModel(params.providerId, params.modelId)
    if (!model) {
      yield {
        type: 'error',
        message: `Model not found: ${params.providerId}/${params.modelId}`,
        retryable: false,
        retry: buildRetryInfo(false),
      }
      return
    }
    const isLocalKeyless = KEYLESS_PROVIDERS.has(params.providerId)
    const apiKey = isLocalKeyless
      ? 'local-no-key-needed'
      : (keystoreService.getApiKey(params.providerId) ?? getEnvApiKey(params.providerId))

    if (!apiKey) {
      yield {
        type: 'error',
        message: `No API key for provider: ${params.providerId}`,
        retryable: false,
        retry: buildRetryInfo(false),
      }
      return
    }

    // 创建 AbortController
    // Critical 4.1 修复: 并发 chatStream 会覆盖 abortController,导致前一个无法 abort
    // 策略 1: 进入新 chatStream 前先 abort 并清理旧的 controller,保证只有一个活跃流
    // 策略 2: 记录自己的 controller 引用,finally 只清理自己创建的 controller,
    //         避免在并发场景下错误地清理另一个流的 controller
    if (this.abortController) {
      try {
        this.abortController.abort()
      } catch {
        /* 旧 controller abort 失败不阻塞新流程 */
      }
      this.abortController = null
    }
    this.abortController = new AbortController()
    // 保留自己 controller 的引用,用于 finally 中精确清理
    const myController = this.abortController

    // 构建 pi-ai Context
    // H-5 修复: 不再只取 user 消息,保留 user + assistant 消息以维持完整对话上下文
    // 之前 filter(m => m.role === 'user') 会导致 assistant 的历史回复丢失,
    // LLM 无法理解多轮对话的连贯性
    const conversationMessages = params.messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    )

    // 边界：conversationMessages 为空时直接返回 (不能仅检查 params.messages,
    // 因为可能只含 system/tool 消息,过滤后为空)
    if (conversationMessages.length === 0) {
      yield { type: 'error', message: 'No messages to send', retryable: false, retry: buildRetryInfo(false) }
      return
    }

    // ✅ [Settings wiring] maxTokens 默认值
    // 修复 Bug-1: 之前用 settings.chat.maxTokens 死值(默认 4096/32K)覆盖了 model.maxTokens
    // 现在优先级: 显式传参 > model.maxTokens(用户的 900K 模型自带 32K-128K) > settings 默认 > 4096
    let defaultMaxTokens = 4096
    try {
      const s = settingsService.getSettings()
      const v = s.chat?.maxTokens
      if (typeof v === 'number' && v > 0) defaultMaxTokens = v
    } catch (err) {
      console.warn('[PiAI] Failed to read chat.maxTokens from settings:', err)
    }
    // 修复 Bug-1: maxTokens 至少要 >= model.maxTokens, 不然用户设的 900K 模型收到 4K 截断
    const effectiveOutputMax = Math.max(
      model.maxTokens > 0 ? model.maxTokens : 4096,
      params.maxTokens ?? defaultMaxTokens,
    )
    console.log(
      `[PiAI] chatStream: model.contextWindow=${model.contextWindow} model.maxTokens=${model.maxTokens} effectiveOutputMax=${effectiveOutputMax}`,
    )

    // ✅ [Settings wiring] 对话压缩:读取 compaction 设置并在构建 Context 前压缩旧消息
    // Chat 链路: 调 LLM 生成结构化摘要(与 Agent 链路一致),失败时回退到字符串截断
    // 修复 Bug-2: reserveTokens 上限按 model.contextWindow 自适应(10%, 至少 4096)
    let compactionEnabled = false
    let reserveTokens = 8000
    let keepRecentTokens = 16000
    try {
      const s = settingsService.getSettings()
      compactionEnabled = s.chat?.compaction?.enabled ?? false
      reserveTokens = s.chat?.compaction?.reserveTokens ?? 8000
      keepRecentTokens = s.chat?.compaction?.keepRecentTokens ?? 16000
    } catch {
      /* 默认值 */
    }
    // 自适应: 当 model.contextWindow 巨大(如 900K)时不应用用户填的 8K reserve
    const adaptiveReserve = Math.max(
      4096,
      Math.min(reserveTokens, Math.floor(model.contextWindow * 0.1)),
    )

    // 应用压缩(仅当启用且消息数量 > 2)
    // 优先使用 LLM 摘要(与 Agent 链路体验一致),失败时降级到字符串截断
    // H-5 修复: 使用 conversationMessages(含 user + assistant)而非只 user 消息
    const sourceMessages = conversationMessages.length > 0 ? conversationMessages : params.messages
    let messagesToUse: Array<{ role: string; content: string }> = sourceMessages

    if (compactionEnabled && sourceMessages.length > 2) {
      // 构造 AgentMessage 序列供 compactAgentMessages 使用
      // 使用宽松 cast: Chat 链路只关心 user-role 文本
      const agentMsgs: AgentMessage[] = sourceMessages.map(
        (m, i) =>
          ({
            role: 'user',
            content: m.content,
            timestamp: Date.now() - (sourceMessages.length - i) * 1000,
          }) as unknown as AgentMessage,
      )
      try {
        const compacted = await compactAgentMessages(
          agentMsgs,
          model,
          { enabled: true, reserveTokens: adaptiveReserve, keepRecentTokens },
          apiKey,
          myController.signal,
        )
        if (compacted.length < agentMsgs.length) {
          // 压缩生效:把结果转回简化格式(宽松 cast 处理 AgentMessage 联合类型)
          messagesToUse = compacted.map((m) => {
            const content = (m as { content?: unknown }).content
            const role = (m as { role?: string }).role ?? 'user'
            if (typeof content === 'string') return { role, content }
            if (Array.isArray(content)) {
              const text = content
                .filter((raw): raw is { type: 'text'; text: string } => {
                  const b = raw as { type?: string; text?: string }
                  return b?.type === 'text' && typeof b.text === 'string'
                })
                .map((b) => b.text)
                .join('\n')
              return { role, content: text }
            }
            return { role, content: String(content ?? '') }
          })
          console.log(
            `[PiAI] Compaction: ${sourceMessages.length} → ${messagesToUse.length} messages`,
          )
        }
      } catch (err) {
        console.warn('[PiAI] LLM compaction failed, falling back to truncation:', err)
        // 降级到字符串截断
        messagesToUse = compactChatMessagesSimple(
          sourceMessages,
          model.contextWindow,
          adaptiveReserve,
          keepRecentTokens,
        )
      }
    }

    // H-5 修复: 根据原消息 role 构造对应的 pi-ai Message 类型
    // - user 消息 → UserMessage (简单)
    // - assistant 消息 → 最小合法 AssistantMessage (保留历史回复上下文)
    // 之前所有消息都强制转 role: 'user',导致 LLM 误以为全是用户说的,多轮对话混乱
    const piMessages: Message[] = messagesToUse.map((m) => {
      if (m.role === 'assistant') {
        // 构造最小合法 AssistantMessage,让 pi-ai 能识别这是之前的助手回复
        return {
          role: 'assistant',
          content: [{ type: 'text', text: m.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as AssistantMessage
      }
      // user 和其他角色都作为 UserMessage
      return {
        role: 'user' as const,
        content: m.content,
        timestamp: Date.now(),
      }
    })

    const context: Context = {
      systemPrompt: params.systemPrompt,
      messages: piMessages,
    }

    // reasoning 默认值：仅当模型支持时使用 params.thinking 或 'low'
    // 修复: 'off' 不在 ThinkingLevel 中 ('minimal'|'low'|'medium'|'high'|'xhigh'),
    // 但 streamSimple 接收的是 ThinkingLevel | undefined, 所以排除 'off'
    const reasoning: ThinkingLevel | undefined = model.reasoning
      ? params.thinking === 'off'
        ? 'low'
        : (params.thinking ?? 'low')
      : undefined

    // 发起流式请求
    // 修复 Bug-1: 之前用 params.maxTokens ?? defaultMaxTokens (4096) 覆盖了 model.maxTokens
    // 现在用 effectiveOutputMax (max(model.maxTokens, params.maxTokens ?? defaultMaxTokens))
    const stream = streamSimple(model, context, {
      apiKey,
      reasoning,
      maxTokens: effectiveOutputMax,
      signal: myController.signal,
    })

    yield { type: 'start', model: model.id, provider: model.provider }

    // 注: retry 配置已在函数开头读取 (R132 修复: 前置以使所有 error 路径都附带 retry 元信息)
    // 注: streamSimple 返回的 AsyncIterable 一旦被消费无法复用,
    // 所以"完整自动重试"需重构为函数式 streamSimple(每次重试重建),不在本次范围。
    // 此处仅:(1) 读 settings 让配置项不再是死字段
    //       (2) 错误事件附带 retry 元信息,渲染端可选择手工重试
    console.log(
      `[PiAI] retry policy: enabled=${retryEnabled} maxRetries=${maxRetries} baseDelay=${baseDelayMs}ms timeout=${providerTimeoutMs}ms`,
    )

    try {
      // T2: AI 流事件全量落盘(chat.conversationLogging 关闭时跳过)
      let conversationLogging = true
      try {
        conversationLogging = settingsService.getSettings().chat?.conversationLogging !== false
      } catch {
        /* 默认 true */
      }

      for await (const event of stream) {
        const mapped = mapEvent(event)
        if (mapped) {
          if (conversationLogging) {
            logChat('event', { type: mapped.type, ...(mapped as object) })
          }
          yield mapped
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const retryable = isRetryableError(message)
      // 把 retry 配置附在 error 事件,渲染端可基于此做手动重试
      yield {
        type: 'error',
        message,
        retryable,
        retry: buildRetryInfo(retryable),
      }
    } finally {
      // Critical 4.1 修复: 只清理自己创建的 controller,避免覆盖另一个并发 chatStream 的 controller
      if (this.abortController === myController) {
        this.abortController = null
      }
    }
  }

  /** 中止当前对话 */
  abortCurrentChat() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  // ===========================================================
  // API Key 管理
  // ===========================================================

  setApiKey(providerId: string, apiKey: string) {
    keystoreService.setApiKey(providerId, apiKey)
    // OPT-1: API key 变更后清除失败缓存,允许重新尝试在线模型获取
    this.failedOnlineFetch.delete(providerId)
    // R136: API key 变更可能影响在线模型列表,失效缓存
    this.modelsCache.delete(providerId)
  }

  deleteApiKey(providerId: string) {
    keystoreService.deleteApiKey(providerId)
    // OPT-1: API key 删除后清除失败缓存
    this.failedOnlineFetch.delete(providerId)
    // R136: API key 删除后在线模型列表会变化,失效缓存
    this.modelsCache.delete(providerId)
  }

  getApiKey(providerId: string): string | undefined {
    return keystoreService.getApiKey(providerId) ?? getEnvApiKey(providerId)
  }

  // ===========================================================
  // 内部工具方法
  // ===========================================================

  /** 安全获取模型列表（不抛异常） */
  private safeGetModels(providerId: string): Model<Api>[] {
    try {
      return getModels(providerId as Parameters<typeof getModels>[0])
    } catch (err) {
      console.warn(
        `[PiAI] getModels("${providerId}") threw:`,
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  /** 解析模型 - 找不到时回退到自定义模型构造（核心修复） */
  private resolveModel(providerId: string, modelId: string): Model<Api> | undefined {
    // 1. 先尝试 pi-ai 静态注册表
    try {
      const found = getModel(
        providerId as Parameters<typeof getModel>[0],
        modelId as Parameters<typeof getModel>[1],
      )
      if (found) return found
    } catch {
      // 静态注册表找不到，继续回退
    }

    // 1b. 本地 Ollama 模型: 不在静态注册表里,直接构造
    if (providerId === 'ollama') {
      const model = {
        id: modelId,
        name: modelId,
        api: 'openai-completions' as Api,
        provider: 'ollama' as unknown as Model<Api>['provider'],
        baseUrl: OLLAMA_OPENAI_BASE_URL,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 4096,
      } as Model<Api>
      console.log(
        `[PiAI] Resolved Ollama model: ${modelId} (openai-compat at ${OLLAMA_OPENAI_BASE_URL})`,
      )
      return model
    }

    // 2. 回退：从自定义模型设置中构造 Model<Api> 兼容对象
    const settings = settingsService.getSettings()
    const customModels = settings.models.customModels?.[providerId]
    if (!customModels || customModels.length === 0) return undefined

    const custom = customModels.find((m) => m.id === modelId)
    if (!custom) return undefined

    // 从 provider 静态模型获取默认 api 和 baseUrl
    const staticModels = this.safeGetModels(providerId)
    const defaultApi = staticModels.length > 0 ? staticModels[0].api : 'openai-completions'
    const defaultBaseUrl = staticModels.length > 0 ? staticModels[0].baseUrl : ''

    // 构造 pi-ai 兼容的 Model<Api> 对象
    // 修复 Bug-1: 真正透传用户填的 contextWindow —— 不是猜 900K, 也不是 32K
    // 1) 优先用用户在 Models 页面填的 custom.contextWindow
    // 2) 兜底 900K (与 SettingsPage 同步显示"未设置时默认 900K"对齐)
    // 3) 最后才 32768 (兼容老代码)
    const resolvedContextWindow =
      typeof custom.contextWindow === 'number' && custom.contextWindow > 0
        ? custom.contextWindow
        : 900000
    const model: Model<Api> = {
      id: custom.id,
      name: custom.name,
      api: (custom.api ?? defaultApi) as Api,
      provider: providerId as Model<Api>['provider'],
      baseUrl: custom.baseUrl ?? defaultBaseUrl,
      reasoning: custom.supportsReasoning ?? false,
      input: ['text'],
      cost: {
        input: custom.costPerInputToken ?? 0,
        output: custom.costPerOutputToken ?? 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: resolvedContextWindow,
      maxTokens: custom.maxOutputTokens ?? 4096,
    }

    console.log(
      `[PiAI] Resolved custom model: ${providerId}/${modelId} (api: ${model.api}, baseUrl: ${model.baseUrl}, contextWindow: ${model.contextWindow} ${typeof custom.contextWindow === 'number' ? '(from settings)' : '(default 900K)'})`,
    )
    return model
  }

  // ===========================================================
  // OAuth 登录（PKCE/device-code 流程）
  // ===========================================================

  /**
   * 启动 OAuth 登录流程
   * 当前实现: 引导式 API Key 获取流程
   *   1. 打开 provider 的 API Key 页面
   *   2. 返回 authUrl 让前端显示引导信息
   *   3. 用户手动复制 Key 后通过 setApiKey 存入 keystore
   * TODO: 后续接入完整 PKCE/device-code 流程
   */
  async oauthLogin(providerId: string): Promise<{
    success: boolean
    error?: string
    authUrl?: string
    pollInterval?: number
  }> {
    if (!OAUTH_PROVIDERS.has(providerId)) {
      return {
        success: false,
        error: `Provider ${providerId} does not support OAuth. Please use API key instead.`,
      }
    }

    const keyUrl = OAUTH_KEY_URLS[providerId]
    if (!keyUrl) {
      return {
        success: false,
        error: `No key URL configured for provider ${providerId}.`,
      }
    }

    // 在系统浏览器中打开 API Key 页面
    try {
      const { shell } = await import('electron')
      await shell.openExternal(keyUrl)
    } catch (err) {
      console.warn('[PiAI] Failed to open OAuth URL:', err)
    }

    return {
      success: true,
      authUrl: keyUrl,
      pollInterval: 0,
    }
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
