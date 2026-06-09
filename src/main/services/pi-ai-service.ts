// =============================================================
// Pi AI Service - 统一 LLM 接口
// 已接入 @earendil-works/pi-ai，零改动复用 30+ Provider
// =============================================================

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
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
} from '@earendil-works/pi-ai'
import type { ModelInfo, ProviderInfo, StreamEvent, TestConnectionResult } from '../../shared/types'
import { logChat } from '../utils/logger'
import { compactAgentMessages, compactChatMessagesSimple } from './compaction-helper'
import { keystoreService } from './keystore-service'
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
  // 缓存在线模型获取失败的 provider，避免重复请求已知不支持 /models 端点的 provider
  private failedOnlineFetch = new Set<string>()

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

    const results = providerIds.map((id) => {
      const models = this.safeGetModels(id)
      // ✅ 应用 enabledModels 过滤:若白名单非空,只保留白名单里的 model
      const filteredModels =
        enabledModels.length > 0 ? models.filter((m) => enabledModels.includes(m.id)) : models
      const keystoreKey = keystoreService.getApiKey(id)
      const envKey = getEnvApiKey(id)
      const hasApiKey = !!(keystoreKey || envKey)

      return {
        id,
        name: PROVIDER_NAMES[id] ?? id,
        supportsOAuth: OAUTH_PROVIDERS.has(id),
        hasApiKey,
        modelCount: filteredModels.length,
        // 若 enabledModels 把所有 model 都过滤掉了,标 disabled 提示用户
        hidden:
          blacklist.includes(id) ||
          (enabledModels.length > 0 && filteredModels.length === 0 && models.length > 0),
      }
    })

    const configured = results.filter((p) => p.hasApiKey && p.modelCount > 0)
    console.log(
      `[PiAI] Configured providers (hasApiKey && modelCount>0): ${configured.length} -> [${configured.map((p) => p.id).join(', ')}]`,
    )

    return results
  }

  /** 列出指定 Provider 的所有模型（综合静态 + 自定义 + 在线获取） */
  async listModels(providerId: string): Promise<ModelInfo[]> {
    return this.listAllKnownModels(providerId)
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

      if (resolvedBaseUrl && resolvedApiKey) {
        // 跳过已知 /models 端点不可用的 provider
        if (this.failedOnlineFetch.has(providerId)) {
          console.log(`[PiAI] Skipping online model fetch for ${providerId} (previously failed)`)
        } else {
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
                onlineModels = data.data.map((m) => ({
                  id: m.id,
                  name: m.id,
                  providerId,
                  api: sampleModel.api as string,
                  contextWindow: 32768,
                  maxOutputTokens: 4096,
                  costPerInputToken: 0,
                  costPerOutputToken: 0,
                  costCacheRead: 0,
                  costCacheWrite: 0,
                  supportsReasoning: false,
                  baseUrl: resolvedBaseUrl,
                }))
                console.log(
                  `[PiAI] Fetched ${onlineModels.length} models online from ${providerId}`,
                )
              }
            } else {
              console.warn(
                `[PiAI] Online model fetch for ${providerId} returned ${response.status}, caching as failed`,
              )
              this.failedOnlineFetch.add(providerId)
            }
          } catch (err) {
            console.warn(
              `[PiAI] Failed to fetch models online for ${providerId}:`,
              err instanceof Error ? err.message : String(err),
            )
            this.failedOnlineFetch.add(providerId)
          }
        }
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

    return this.dedupeModels([...staticInfos, ...onlineModels, ...customInfos])
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
    console.log(`[PiAI] Updated custom model "${modelId}" in ${providerId}:`, Object.keys(updates))
    return true
  }

  /** 按 id 去重模型列表（保留第一个） */
  private dedupeModels(models: ModelInfo[]): ModelInfo[] {
    const seen = new Set<string>()
    return models.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
  }

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
    const testModel = this.selectCheapestModel(models)

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
    // 解析模型
    const model = this.resolveModel(params.providerId, params.modelId)
    if (!model) {
      yield {
        type: 'error',
        message: `Model not found: ${params.providerId}/${params.modelId}`,
        retryable: false,
      }
      return
    }
    const apiKey = keystoreService.getApiKey(params.providerId) ?? getEnvApiKey(params.providerId)

    if (!apiKey) {
      yield {
        type: 'error',
        message: `No API key for provider: ${params.providerId}`,
        retryable: false,
      }
      return
    }

    // 创建 AbortController
    this.abortController = new AbortController()

    // 构建 pi-ai Context
    // pi-ai 的 Message 类型区分 UserMessage 和 AssistantMessage（后者需要 api/usage 等字段）
    // 简单对话场景下，我们只传入 user 消息，由 pi-ai 内部管理上下文
    const userMessages = params.messages.filter((m) => m.role === 'user')

    // 边界：params.messages 为空时直接返回
    if (params.messages.length === 0) {
      yield { type: 'error', message: 'No messages to send', retryable: false }
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
    const sourceMessages = userMessages.length > 0 ? userMessages : params.messages
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
          this.abortController.signal,
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

    const piMessages: Message[] = messagesToUse.map((m) => ({
      role: 'user' as const,
      content: m.content,
      timestamp: Date.now(),
    }))

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
      signal: this.abortController.signal,
    })

    yield { type: 'start', model: model.id, provider: model.provider }

    // ✅ [Settings wiring] 读取 models.retry.* 配置
    // 默认值:enabled=true / maxRetries=3 / baseDelayMs=1000 / providerTimeoutMs=60000
    // 注: streamSimple 返回的 AsyncIterable 一旦被消费无法复用,
    // 所以"完整自动重试"需重构为函数式 streamSimple(每次重试重建),不在本次范围。
    // 此处仅:(1) 读 settings 让配置项不再是死字段
    //       (2) 错误事件附带 retry 元信息,渲染端可选择手工重试
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
      console.log(
        `[PiAI] retry policy: enabled=${retryEnabled} maxRetries=${maxRetries} baseDelay=${baseDelayMs}ms timeout=${providerTimeoutMs}ms`,
      )
    } catch (err) {
      console.warn('[PiAI] Failed to read models.retry.* from settings:', err)
    }

    try {
      // T2: AI 流事件全量落盘(chat.conversationLogging 关闭时跳过)
      let conversationLogging = true
      try {
        conversationLogging = settingsService.getSettings().chat?.conversationLogging !== false
      } catch {
        /* 默认 true */
      }

      for await (const event of stream) {
        const mapped = this.mapEvent(event)
        if (mapped) {
          if (conversationLogging) {
            logChat('event', { type: mapped.type, ...(mapped as object) })
          }
          yield mapped
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const retryable =
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('429') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('ECONNRESET') ||
        message.includes('ECONNREFUSED')
      // 把 retry 配置附在 error 事件,渲染端可基于此做手动重试
      yield {
        type: 'error',
        message,
        retryable,
        retry: {
          enabled: retryEnabled,
          maxRetries,
          baseDelayMs,
          providerTimeoutMs,
          shouldRetry: retryable && retryEnabled && maxRetries > 0,
        },
      }
    } finally {
      this.abortController = null
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
  }

  deleteApiKey(providerId: string) {
    keystoreService.deleteApiKey(providerId)
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

  /** 选择最便宜的模型用于连接测试 */
  private selectCheapestModel(models: Model<Api>[]): Model<Api> {
    if (models.length === 0) {
      throw new Error('selectCheapestModel: empty model list')
    }
    const score = (m: Model<Api>): number => {
      const input = Number.isFinite(m.cost?.input) ? m.cost.input : Number.POSITIVE_INFINITY
      const output = Number.isFinite(m.cost?.output) ? m.cost.output : Number.POSITIVE_INFINITY
      return input + output
    }
    return models.reduce((cheapest, m) => (score(m) < score(cheapest) ? m : cheapest))
  }

  /** 将 pi-ai 的 AssistantMessageEvent 映射为前端的 StreamEvent */
  private mapEvent(event: AssistantMessageEvent): StreamEvent | null {
    switch (event.type) {
      case 'start':
        // start 已在 chatStream 中手动 yield
        return null

      case 'text_start':
        return { type: 'text_start' }

      case 'text_delta':
        return { type: 'text_delta', delta: event.delta }

      case 'text_end':
        return { type: 'text_end' }

      case 'thinking_start':
        return { type: 'thinking_start' }

      case 'thinking_delta':
        return { type: 'thinking_delta', delta: event.delta }

      case 'thinking_end':
        return { type: 'thinking_end' }

      case 'toolcall_start': {
        const tc = this.extractPartialToolCall(event.partial, event.contentIndex)
        return tc ? { type: 'toolcall_start', id: tc.id, name: tc.name } : null
      }

      case 'toolcall_delta':
        return { type: 'toolcall_delta', id: '', argsDelta: event.delta }

      case 'toolcall_end':
        return { type: 'toolcall_end', id: event.toolCall.id }

      case 'done': {
        const msg = event.message
        const usage = msg.usage
        return {
          type: 'done',
          usage: {
            inputTokens: usage?.input ?? 0,
            outputTokens: usage?.output ?? 0,
            cacheReadTokens: usage?.cacheRead ?? 0,
            cacheWriteTokens: usage?.cacheWrite ?? 0,
          },
          cost: usage?.cost?.total ?? 0,
        }
      }

      case 'error': {
        const msg = event.error
        return {
          type: 'error',
          message: msg.errorMessage ?? 'Unknown error',
          retryable: event.reason === 'aborted',
        }
      }

      default:
        return null
    }
  }

  /** 从 partial AssistantMessage 中提取 toolCall 信息 */
  private extractPartialToolCall(
    partial: AssistantMessage,
    contentIndex: number,
  ): { id: string; name: string } | null {
    const block = partial.content[contentIndex]
    if (block && block.type === 'toolCall') {
      return { id: block.id, name: block.name }
    }
    return null
  }

  // ===========================================================
  // 对话压缩 (Feature J)
  // 压缩逻辑已迁移到 ./compaction-helper.ts:
  //   - compactAgentMessages: LLM 摘要版(Agent + Chat 链路统一使用)
  //   - compactChatMessagesSimple: 字符串截断版(LLM 失败时的降级方案)
  // ===========================================================
}

export const piAIService = new PiAIService()
