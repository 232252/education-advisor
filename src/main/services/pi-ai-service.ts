import type { ModelThinkingLevel } from '@main/services/llm-contracts'
// =============================================================
// Pi AI Service - 统一 LLM 接口（编排层）
// 已接入 @earendil-works/pi-ai，零改动复用 30+ Provider
//
// 实现已按职责拆分到 ./pi-ai/ 子目录（纯重构,行为零变化）:
//   - pi-ai/providers.ts       provider 常量表(OAUTH_PROVIDERS 等) + listProviders/oauthLogin
//   - pi-ai/model-utils.ts     safeGetModels/resolveModel + 静态/自定义模型 ModelInfo 映射
//   - pi-ai/model-fetch.ts     在线模型获取(失败 TTL 缓存 + in-flight 去重)
//   - pi-ai/streaming.ts       流式对话(重试/首字节超时/abort/压缩)
//   - pi-ai/provider-models.ts fetchProviderModels(静态+keyless+在线+自定义 合并去重)
//   - pi-ai/custom-models.ts   自定义模型 CRUD(settings.models.customModels)
//   - pi-ai/connection-test.ts testConnection(最小请求验证 API Key)
// 本文件保留 PiAIService 类骨架: 公共方法签名不变,委托子模块组合。
// =============================================================

import { getEnvApiKey } from '@earendil-works/pi-ai/compat'
import type { ModelInfo, ProviderInfo, StreamEvent, TestConnectionResult } from '@shared/types'
import { dshRouteFor } from './dsh/route'
import { createDshRuntime, type DshRuntime, dshPinnedKey } from './dsh/runtime'
import { TtlLruCache } from './eaa-cache'
import { keystoreService } from './keystore-service'
import { testProviderConnection } from './pi-ai/connection-test'
import {
  addCustomModelEntry,
  type CustomModelInput,
  type CustomModelUpdates,
  removeCustomModelEntry,
  updateCustomModelEntry,
} from './pi-ai/custom-models'
import { OnlineModelsFetcher } from './pi-ai/model-fetch'
import { fetchProviderModels } from './pi-ai/provider-models'
import { listProviders, oauthLogin } from './pi-ai/providers'
import { ChatStreamRunner } from './pi-ai/streaming'
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
  /** 流式对话执行器(pi 后端;abortController 并发管理见 pi-ai/streaming.ts) */
  private piRunner: ChatStreamRunner | null = null
  /**
   * dsh 后端。SDK 的路由(provider/model)在 initialize 时进程级定死，
   * 因此按首个请求的 provider/model 懒建；换路由需重启或等 dsh 提供切换方法。
   */
  private dshRunner: DshRuntime | null = null

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
   * 从 API 在线获取模型列表 — 合并逻辑见 pi-ai/provider-models.ts
   * (静态 + keyless 本地 + 在线 + 自定义,去重)
   */
  async fetchProviderModels(
    providerId: string,
    baseUrl?: string,
    apiKey?: string,
  ): Promise<ModelInfo[]> {
    return fetchProviderModels(providerId, this.onlineFetcher, baseUrl, apiKey)
  }

  /** 综合获取所有已知模型：静态 + 自定义 + 在线 */
  async listAllKnownModels(providerId: string): Promise<ModelInfo[]> {
    return this.fetchProviderModels(providerId)
  }

  /** 添加自定义模型到指定 Provider — CRUD 逻辑见 pi-ai/custom-models.ts */
  addCustomModel(providerId: string, model: CustomModelInput): ModelInfo {
    const result = addCustomModelEntry(providerId, model)
    // R136: 自定义模型变更,失效 listModels 缓存
    this.modelsCache.delete(providerId)
    return result
  }

  /** 从指定 Provider 移除自定义模型 */
  removeCustomModel(providerId: string, modelId: string): boolean {
    const removed = removeCustomModelEntry(providerId, modelId)
    if (removed) {
      // R136: 自定义模型变更,失效 listModels 缓存
      this.modelsCache.delete(providerId)
    }
    return removed
  }

  /** 更新自定义模型属性 */
  updateCustomModel(providerId: string, modelId: string, updates: CustomModelUpdates): boolean {
    const updated = updateCustomModelEntry(providerId, modelId, updates)
    if (updated) {
      // R136: 自定义模型变更,失效 listModels 缓存
      this.modelsCache.delete(providerId)
    }
    return updated
  }

  /** 按 id 去重模型列表 — 已委托到 ./pi-ai-helpers.ts dedupeModels */

  // ===========================================================
  // 连接测试 — 委托 pi-ai/connection-test.ts testProviderConnection
  // ===========================================================

  /** 测试 Provider 连接（发送一个最小请求验证 API Key） */
  async testConnection(
    providerId: string,
    apiKey: string,
    _baseUrl?: string,
  ): Promise<TestConnectionResult> {
    return testProviderConnection(providerId, apiKey, _baseUrl)
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
    yield* this.resolveStreamRunner(params).chatStream(params)
  }

  /**
   * 按 settings.models.agentRuntime 选择流式后端，缺省 'dsh'（pi 保留为回退项）。
   * 两个后端的 chatStream 参数与 AsyncGenerator<StreamEvent> 返回一致，可互换。
   */
  private resolveStreamRunner(params: {
    providerId: string
    modelId: string
    maxTokens?: number
  }): ChatStreamRunner | DshRuntime {
    let backend: 'pi' | 'dsh' = 'pi'
    try {
      backend = settingsService.getSettings().models?.agentRuntime ?? 'dsh'
    } catch (err) {
      // 启动早期/单测环境设置未就绪时回落 pi，读配置失败不该打断对话
      console.warn('[PiAI] settings unreadable, falling back to pi runtime:', err)
    }
    if (backend === 'dsh') {
      // 路由名按 settings.models.dshRoutes 映射；渲染端看到的 start 事件仍是
      // 请求里那对 pi id（映射只作用于 dsh 子进程）
      const route = dshRouteFor(params.providerId, params.modelId)
      const key = dshPinnedKey({
        provider: route.providerId,
        model: route.modelId,
        maxTokens: params.maxTokens,
      })
      if (!this.dshRunner) {
        // 对话链路在 pi 路径上不传 tools，所以这里不挂 MCP 端点；但 createDshRuntime
        // 会带上关掉 harness 自带工具 + 声明凭据路由的 patch。
        this.dshRunner = createDshRuntime({
          provider: route.providerId,
          model: route.modelId,
          maxTokens: params.maxTokens,
        })
      } else if (this.dshRunner.routeKey !== key) {
        // initialize 把 provider/model 定死在子进程级，SDK 没有按请求覆盖的入口；
        // 复用旧进程等于用户在界面上换了模型却仍在打旧模型 —— 只能换子进程。
        const retiring = this.dshRunner
        this.dshRunner = createDshRuntime({
          provider: route.providerId,
          model: route.modelId,
          maxTokens: params.maxTokens,
        })
        void retiring.disposeWhenIdle().catch((err: unknown) => {
          console.warn('[PiAI] dsh runtime retire failed:', err)
        })
      }
      return this.dshRunner
    }
    if (!this.piRunner) this.piRunner = new ChatStreamRunner()
    return this.piRunner
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
  //   - selectCheapestModel / selectProbeModel: 连接测试选探测模型(跳过套餐专属 SKU)
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
