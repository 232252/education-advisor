// =============================================================
// Pi AI — 自定义模型 CRUD(settings.models.customModels 读写)
// 从 pi-ai-service.ts 下沉(纯重构,行为零变化):
//   - addCustomModelEntry:    添加/覆盖自定义模型并返回 ModelInfo
//   - removeCustomModelEntry: 移除自定义模型
//   - updateCustomModelEntry: 更新自定义模型属性
// 注:listModels 缓存(modelsCache)由编排层持有,增删改后由编排层负责失效。
// =============================================================

import type { ModelInfo } from '@shared/types'
import { settingsService } from '../settings-service'
import { safeGetModels } from './model-utils'

/** addCustomModel 的入参结构(与 PiAIService 公共方法签名保持一致) */
export interface CustomModelInput {
  id: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  supportsReasoning?: boolean
  costPerInputToken?: number
  costPerOutputToken?: number
  api?: string
  baseUrl?: string
}

/** updateCustomModel 的入参结构(与 PiAIService 公共方法签名保持一致) */
export interface CustomModelUpdates {
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  supportsReasoning?: boolean
  costPerInputToken?: number
  costPerOutputToken?: number
  api?: string
  baseUrl?: string
}

/** 添加自定义模型到指定 Provider(同 id 覆盖而非追加),返回带 isCustom 标记的 ModelInfo */
export function addCustomModelEntry(providerId: string, model: CustomModelInput): ModelInfo {
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
  console.log(`[PiAI] Added custom model "${model.id}" to ${providerId} (total: ${updated.length})`)

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

/** 从指定 Provider 移除自定义模型;不存在返回 false */
export function removeCustomModelEntry(providerId: string, modelId: string): boolean {
  const settings = settingsService.getSettings()
  const existing = settings.models.customModels?.[providerId] ?? []
  const filtered = existing.filter((m) => m.id !== modelId)
  if (filtered.length === existing.length) return false
  settingsService.setCustomModels(providerId, filtered)
  console.log(`[PiAI] Removed custom model "${modelId}" from ${providerId}`)
  return true
}

/** 更新自定义模型属性(未指定字段保持原值);目标不存在返回 false */
export function updateCustomModelEntry(
  providerId: string,
  modelId: string,
  updates: CustomModelUpdates,
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
