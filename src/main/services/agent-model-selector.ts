// =============================================================
// Agent 模型选择层 — selectModel/resolveCustomModel/ApiKey 解析/续跑常量
// 从 agent-service.ts 抽出。逻辑零修改(逐行对照搬迁)。
// 这些函数不依赖 AgentService 的 this 状态,只读 settingsService/keystoreService
// 单例 + pi-ai 静态注册表,可纯函数测试。
// =============================================================

import type { Api, Model } from '@earendil-works/pi-ai/compat'
import { getEnvApiKey, getModel, getModels, getProviders } from '@earendil-works/pi-ai/compat'
import { keystoreService } from './keystore-service'
import { settingsService } from './settings-service'

/** 模型提前结束时最多续跑次数 */
export const MAX_CONTINUATIONS = 5
/** 输出少于此字符时触发续跑 */
export const MIN_OUTPUT_CHARS = 200
/** 轮次少于此数时触发续跑 */
export const MIN_TURN_COUNT = 3

/** 防御性 NaN guard：cost 字段可能为 undefined 或非有限数 */
export function safeCostScore(m: Model<Api>): number {
  const input = Number.isFinite(m.cost?.input) ? m.cost.input : Number.POSITIVE_INFINITY
  const output = Number.isFinite(m.cost?.output) ? m.cost.output : Number.POSITIVE_INFINITY
  return input + output
}

export function hasApiKey(provider: string): boolean {
  return !!(keystoreService.getApiKey(provider) || getEnvApiKey(provider))
}

/** 从 settings 自定义模型中构造 Model<Api> 兼容对象（与 pi-ai-service.resolveModel 逻辑一致） */
export function resolveCustomModel(providerId: string, modelId: string): Model<Api> | undefined {
  const settings = settingsService.getSettings()
  const customModels = settings.models.customModels?.[providerId]
  if (!customModels || customModels.length === 0) return undefined

  const custom = customModels.find((m) => m.id === modelId)
  if (!custom) return undefined

  // 从 provider 静态模型获取默认 api 和 baseUrl
  let defaultApi = 'openai-completions'
  let defaultBaseUrl = ''
  try {
    const staticModels = getModels(providerId as Parameters<typeof getModels>[0])
    if (staticModels.length > 0) {
      defaultApi = staticModels[0].api
      defaultBaseUrl = staticModels[0].baseUrl
    }
  } catch (err) {
    // provider 不在静态注册表，使用默认值
    console.warn(
      `[AgentService] getModels threw for provider "${providerId}" (custom provider expected):`,
      err instanceof Error ? err.message : err,
    )
  }

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
    // 修复 Bug-1: 真正透传用户填的 contextWindow
    // 1) 用户填了 → 用用户的 (log 标 from settings)
    // 2) 用户没填 → 默认 900K (与 SettingsPage 对齐)
    // 3) 最后才 32768
    contextWindow:
      typeof custom.contextWindow === 'number' && custom.contextWindow > 0
        ? custom.contextWindow
        : 900000,
    maxTokens: custom.maxOutputTokens ?? 4096,
  }

  console.log(
    `[AgentService] Resolved custom model: ${providerId}/${modelId} (api: ${model.api}, baseUrl: ${model.baseUrl}, contextWindow: ${model.contextWindow} ${typeof custom.contextWindow === 'number' ? '(from settings)' : '(default 900K)'})`,
  )
  return model
}

/**
 * 根据 modelTier 选择模型(支持自定义 provider + API key 验证)
 * 修复 Bug-1: 用户的 defaultProvider + defaultModel(含 900K contextWindow 等自定义)必须能传过来
 * 之前 tier 路径不读 defaultModel, 选了 tier 标签但用了 static 注册表的 model(默认 32K)
 */
export function selectModel(tier: 'high_quality' | 'low_cost'): Model<Api> {
  const settings = settingsService.getSettings()
  const providerId = settings.models.defaultProvider
  // 优先 defaultModel(用户在 Models 页面选的那个,含自定义 900K contextWindow)
  // 然后是 tier 对应的 highQualityModel/lowCostModel
  let modelId = settings.models.defaultModel
  if (!modelId) {
    modelId =
      tier === 'high_quality' ? settings.models.highQualityModel : settings.models.lowCostModel
  }

  console.log(
    `[AgentService] selectModel: tier=${tier} provider=${providerId} model=${modelId} (using defaultModel first to inherit user's selected model contextWindow)`,
  )

  // 1. 尝试使用配置的具体模型（静态注册表 + 自定义模型回退）
  if (modelId && providerId && hasApiKey(providerId)) {
    // 1a. 静态注册表（注意：getModel 找不到时返回 undefined，不抛异常）
    const staticModel = getModel(
      providerId as Parameters<typeof getModel>[0],
      modelId as Parameters<typeof getModel>[1],
    )
    if (staticModel) {
      console.log(`[AgentService] selectModel: using static model ${providerId}/${modelId}`)
      return staticModel
    }
    // 1b. 自定义模型（settings.models.customModels）
    const custom = resolveCustomModel(providerId, modelId)
    if (custom) {
      console.log(`[AgentService] selectModel: using custom model ${providerId}/${modelId}`)
      return custom
    }
  } else if (modelId && providerId) {
    console.log(
      `[AgentService] selectModel: configured provider ${providerId} has no API key, skipping`,
    )
  }

  // 2. 尝试默认 provider 的任意可用模型（含自定义模型）
  if (providerId && hasApiKey(providerId)) {
    // 2a. 静态模型
    try {
      const models = getModels(providerId as Parameters<typeof getModels>[0])
      if (models.length > 0) {
        const selected =
          tier === 'high_quality'
            ? models.reduce((best, m) => (safeCostScore(m) > safeCostScore(best) ? m : best))
            : models.reduce((cheapest, m) =>
                safeCostScore(m) < safeCostScore(cheapest) ? m : cheapest,
              )
        console.log(
          `[AgentService] selectModel: using provider ${providerId} auto-selected ${selected.id}`,
        )
        return selected
      }
    } catch (err) {
      // 静态模型查找失败（如自定义 provider），继续尝试自定义模型
      console.warn(
        `[AgentService] getModels threw for default provider "${providerId}" (will try custom models):`,
        err instanceof Error ? err.message : err,
      )
    }

    // 2b. 自定义模型列表
    const customModels = settings.models.customModels?.[providerId]
    if (customModels && customModels.length > 0) {
      const cm = customModels[0]
      const resolved = resolveCustomModel(providerId, cm.id)
      if (resolved) {
        console.log(`[AgentService] selectModel: using first custom model ${providerId}/${cm.id}`)
        return resolved
      }
    }
  }

  // 3. 遍历所有已配置 API key 的 provider（静态 + 自定义）
  console.log('[AgentService] selectModel: falling back to scanning all providers with API keys')
  const allProviderIds = getProviders()
  for (const pid of allProviderIds) {
    if (!hasApiKey(pid)) continue
    // 3a. 先尝试静态模型
    try {
      const models = getModels(pid as Parameters<typeof getModels>[0])
      if (models.length > 0) {
        const selected =
          tier === 'high_quality'
            ? models.reduce((best, m) => (safeCostScore(m) > safeCostScore(best) ? m : best))
            : models.reduce((cheapest, m) =>
                safeCostScore(m) < safeCostScore(cheapest) ? m : cheapest,
              )
        console.log(`[AgentService] selectModel: fallback to ${pid}/${selected.id}`)
        return selected
      }
    } catch (err) {
      // continue — 该 provider 可能是自定义 provider,静态注册表查不到
      console.warn(
        `[AgentService] getModels threw for provider "${pid}" during fallback scan:`,
        err instanceof Error ? err.message : err,
      )
    }

    // 3b. 也检查该 provider 的自定义模型
    const customModels = settings.models.customModels?.[pid]
    if (customModels && customModels.length > 0) {
      const cm = customModels[0]
      const resolved = resolveCustomModel(pid, cm.id)
      if (resolved) {
        console.log(`[AgentService] selectModel: fallback to custom ${pid}/${cm.id}`)
        return resolved
      }
    }
  }

  // 4. 最终回退：尝试常见模型（仅当有对应 API key 时）
  const fallbacks: Array<[string, string]> = [
    ['anthropic', 'claude-sonnet-4-20250514'],
    ['openai', 'gpt-4o-mini'],
    ['deepseek', 'deepseek-chat'],
  ]
  for (const [p, m] of fallbacks) {
    if (!hasApiKey(p)) continue
    const model = getModel(p as Parameters<typeof getModel>[0], m as Parameters<typeof getModel>[1])
    if (model) {
      console.log(`[AgentService] selectModel: last-resort fallback to ${p}/${m}`)
      return model
    }
  }

  throw new Error(
    'No model available with a configured API key. Please add an API key in Model Management.',
  )
}

/** 获取 API Key */
export function resolveApiKey(provider: string): string | undefined {
  return keystoreService.getApiKey(provider) ?? getEnvApiKey(provider) ?? undefined
}
