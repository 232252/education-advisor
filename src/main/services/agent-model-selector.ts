// =============================================================
// Agent 模型选择层 — selectModel/ApiKey 解析/续跑常量
// 从 agent-service.ts 抽出。
// 这些函数不依赖 AgentService 的 this 状态,只读 settingsService 等单例
// + pi-ai 静态注册表,可纯函数测试。
//
// P0-2/P1-1/P1-2 重构:
//   - 删除 resolveCustomModel(与 pi-ai/model-utils.resolveModel 的平行副本,缺 ollama 分支),
//     统一 import resolveModel
//   - safeCostScore 与 pi-ai-helpers.costScore 是同一实现,保留旧名 re-export
//   - resolveApiKey 委托 piAIService.getApiKey(keystore + env 同源解析)
//   - hasApiKey 对 ollama 等本地 keyless provider 始终返回 true;
//     selectModel 支持从 ollama 已安装模型列表中按 tier 自动选择
// =============================================================

import type { Api, Model } from '@earendil-works/pi-ai/compat'
import { getModel, getModels, getProviders } from '@earendil-works/pi-ai/compat'
// KEYLESS_PROVIDERS 从 ollama/constants 导入(定义单一来源;ollama-service 入口会拉入 electron)
import { KEYLESS_PROVIDERS } from './ollama/constants'
import { buildOllamaModel, resolveModel } from './pi-ai/model-utils'
import { costScore } from './pi-ai-helpers'
import { piAIService } from './pi-ai-service'
import { settingsService } from './settings-service'

/** 模型提前结束时最多续跑次数 */
export const MAX_CONTINUATIONS = 5
/** 输出少于此字符时触发续跑 */
export const MIN_OUTPUT_CHARS = 200
/** 轮次少于此数时触发续跑 */
export const MIN_TURN_COUNT = 3

// P1-2: safeCostScore 与 pi-ai-helpers.costScore 是同一实现(NaN 防御的 input+output 之和),
// 保留旧名 re-export 兼容既有引用(内部直接使用 costScore)
export { costScore as safeCostScore } from './pi-ai-helpers'

/**
 * 判断 provider 是否可用(有 API key 或本地 keyless)。
 * ollama 等本地 keyless provider 不需要 apiKey,视为始终可用
 * (与 listProviders 对 ollama 标记 hasApiKey: true 的语义一致)。
 */
export function hasApiKey(provider: string): boolean {
  if (KEYLESS_PROVIDERS.has(provider)) return true
  return !!resolveApiKey(provider)
}

/**
 * 根据 modelTier 选择模型(支持自定义 provider + API key 验证)
 * 修复 Bug-1: 用户的 defaultProvider + defaultModel(含 900K contextWindow 等自定义)必须能传过来
 * 之前 tier 路径不读 defaultModel, 选了 tier 标签但用了 static 注册表的 model(默认 32K)
 *
 * @param ollamaInstalledModelIds ollama 等本地 keyless provider 的已安装模型 id 列表
 *   (由调用方异步预取 ollamaService.listModels() 后注入;selectModel 是同步纯函数无法内部 await)
 */
export function selectModel(
  tier: 'high_quality' | 'low_cost',
  ollamaInstalledModelIds?: string[],
): Model<Api> {
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

  // 1. 尝试使用配置的具体模型（静态注册表 + ollama/自定义模型回退）
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
    // 1b. ollama/自定义模型 — 统一走 pi-ai/model-utils.resolveModel
    // (P0-2: 删除平行副本 resolveCustomModel,补齐 ollama 本地模型分支)
    const resolved = resolveModel(providerId, modelId)
    if (resolved) {
      console.log(
        `[AgentService] selectModel: using resolved (custom/local) model ${providerId}/${modelId}`,
      )
      return resolved
    }
  } else if (modelId && providerId) {
    console.log(
      `[AgentService] selectModel: configured provider ${providerId} has no API key, skipping`,
    )
  }

  // 2. ollama 等本地 keyless provider 的 tier 自动选择:
  // 不在 pi-ai 静态注册表(getModels 会抛错),改从调用方预取的已安装列表中挑选。
  // 沿用静态表"按成本档位 reduce"的语义:本地模型 cost 全为 0,
  // reduce 相等时保留第一个 → 等效"选第一个可用"
  if (providerId && KEYLESS_PROVIDERS.has(providerId) && hasApiKey(providerId)) {
    const installed = ollamaInstalledModelIds ?? []
    if (installed.length > 0) {
      const localModels = installed.map((id) => buildOllamaModel(id))
      const selected =
        tier === 'high_quality'
          ? localModels.reduce((best, m) => (costScore(m) > costScore(best) ? m : best))
          : localModels.reduce((cheapest, m) => (costScore(m) < costScore(cheapest) ? m : cheapest))
      console.log(
        `[AgentService] selectModel: using local provider ${providerId} auto-selected ${selected.id}`,
      )
      return selected
    }
    console.log(
      `[AgentService] selectModel: local provider ${providerId} has no installed models (serve running?), falling through`,
    )
  }

  // 3. 尝试默认 provider 的任意可用模型（含自定义模型）
  if (providerId && hasApiKey(providerId)) {
    // 3a. 静态模型
    try {
      const models = getModels(providerId as Parameters<typeof getModels>[0])
      if (models.length > 0) {
        const selected =
          tier === 'high_quality'
            ? models.reduce((best, m) => (costScore(m) > costScore(best) ? m : best))
            : models.reduce((cheapest, m) => (costScore(m) < costScore(cheapest) ? m : cheapest))
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

    // 3b. 自定义模型列表
    const customModels = settings.models.customModels?.[providerId]
    if (customModels && customModels.length > 0) {
      const cm = customModels[0]
      const resolved = resolveModel(providerId, cm.id)
      if (resolved) {
        console.log(`[AgentService] selectModel: using first custom model ${providerId}/${cm.id}`)
        return resolved
      }
    }
  }

  // 4. 遍历所有已配置 API key 的 provider（静态 + 自定义）
  console.log('[AgentService] selectModel: falling back to scanning all providers with API keys')
  const allProviderIds = getProviders()
  for (const pid of allProviderIds) {
    if (!hasApiKey(pid)) continue
    // 4a. 先尝试静态模型
    try {
      const models = getModels(pid as Parameters<typeof getModels>[0])
      if (models.length > 0) {
        const selected =
          tier === 'high_quality'
            ? models.reduce((best, m) => (costScore(m) > costScore(best) ? m : best))
            : models.reduce((cheapest, m) => (costScore(m) < costScore(cheapest) ? m : cheapest))
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

    // 4b. 也检查该 provider 的自定义模型
    const customModels = settings.models.customModels?.[pid]
    if (customModels && customModels.length > 0) {
      const cm = customModels[0]
      const resolved = resolveModel(pid, cm.id)
      if (resolved) {
        console.log(`[AgentService] selectModel: fallback to custom ${pid}/${cm.id}`)
        return resolved
      }
    }
  }

  // 5. 最终回退：尝试常见模型（仅当有对应 API key 时）
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

/** 获取 API Key — 委托 piAIService.getApiKey(keystore + 环境变量同源解析,避免重复实现) */
export function resolveApiKey(provider: string): string | undefined {
  return piAIService.getApiKey(provider)
}
