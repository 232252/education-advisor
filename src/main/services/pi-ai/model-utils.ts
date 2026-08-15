// =============================================================
// Pi AI — 模型工具: 安全获取/解析模型 + ModelInfo 映射
// 从 pi-ai-service.ts 拆出。逻辑零修改(逐行对照搬迁)。
// =============================================================

import { type Api, getModel, getModels, type Model } from '@earendil-works/pi-ai/compat'
import type { ModelInfo } from '@shared/types'
// OLLAMA_OPENAI_BASE_URL 从 ollama/constants 导入(而非 ollama-service 单例入口):
// detection.ts 顶层 import electron,经 ollama-service 会把 electron 拉进纯函数模块的依赖链
import { OLLAMA_OPENAI_BASE_URL } from '../ollama/constants'
import { settingsService } from '../settings-service'

/** 安全获取模型列表（不抛异常） */
export function safeGetModels(providerId: string): Model<Api>[] {
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

/**
 * 构造本地 Ollama 模型的 pi-ai Model 对象。
 * Ollama 不在 pi-ai 静态注册表里,所有 ollama 模型(已安装列表/用户指定 id)
 * 统一通过此函数构造:走 OpenAI 兼容端点(OLLAMA_OPENAI_BASE_URL),零成本,默认 32K 上下文。
 */
export function buildOllamaModel(modelId: string): Model<Api> {
  return {
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
}

/** 解析模型 - 找不到时回退到自定义模型构造（核心修复） */
export function resolveModel(providerId: string, modelId: string): Model<Api> | undefined {
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

  // 1b. 本地 Ollama 模型: 不在静态注册表里,直接构造(构造逻辑提取为 buildOllamaModel 供复用)
  if (providerId === 'ollama') {
    const model = buildOllamaModel(modelId)
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
  const staticModels = safeGetModels(providerId)
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

/** 静态模型 → ModelInfo 映射(fetchProviderModels 的合并入参之一) */
export function buildStaticModelInfos(models: Model<Api>[]): ModelInfo[] {
  return models.map((m) => ({
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
}

/** 自定义模型 → ModelInfo 映射(默认 api/baseUrl 从 provider 静态模型获取) */
export function buildCustomModelInfos(
  providerId: string,
  customModels: Array<{
    id: string
    name: string
    contextWindow: number
    maxOutputTokens: number
    supportsReasoning: boolean
    costPerInputToken: number
    costPerOutputToken: number
    api?: string
    baseUrl?: string
  }>,
  baseUrl?: string,
): ModelInfo[] {
  // 自定义模型默认值从 provider 静态模型获取
  const customDefaultModels = safeGetModels(providerId)
  const customDefaultApi =
    customDefaultModels.length > 0 ? customDefaultModels[0].api : 'openai-completions'
  const customDefaultBaseUrl = customDefaultModels.length > 0 ? customDefaultModels[0].baseUrl : ''

  return customModels.map((cm) => ({
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
}
