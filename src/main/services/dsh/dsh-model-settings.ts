// =============================================================
// 教师「模型 / 对话选择器」的 DSH 数据面
//
// 源是官方 llm-pi-ai 目录（随包运行时的 pi-ai catalog）+ 官方 profile 层
// （llm-pi-ai providers、agent-default-model）。密钥仍在应用 keystore，
// 只把 apiKeyEnv 变量名写进 DSH。读写都走这份文档，不再把 EAA/pi 目录
// 当作源再事后打进 DSH。
// =============================================================

import { providerDisplayName } from '@shared/provider-labels'
import type { ModelInfo, ProviderInfo } from '@shared/types'
import {
  type DshCatalogModel,
  ensureDshCatalogReady,
  getDshCatalogSource,
} from './dsh-model-catalog'
import {
  dshCredentialEnvName,
  dshRouteKey,
  envKeyedProviders,
  providersWithKeys,
} from './provider-patch'
import {
  type DshDefaultModelSelection,
  mergeLlmProviderCredentials,
  readDefaultModelSelection,
  readLlmProviders,
  writeDefaultModelSelection,
} from './provider-profile-patch'

export type { DshDefaultModelSelection }

let sdkProfileDir = ''

/** 由 configureDshRuntime 注入：dsh-sdk-home/profiles/sdk */
export function configureDshModelSettings(profileDir: string): void {
  sdkProfileDir = profileDir
}

export function getDshSdkProfileDir(): string {
  return sdkProfileDir
}

function keyedProviderIds(): Set<string> {
  return new Set([...providersWithKeys(), ...envKeyedProviders()])
}

export async function listDshProviders(): Promise<ProviderInfo[]> {
  const catalog = await ensureDshCatalogReady()
  const catalogProviders = catalog.listProviders()
  const profile = sdkProfileDir ? readLlmProviders(sdkProfileDir) : {}
  const keyed = keyedProviderIds()
  const seen = new Set<string>()
  const out: ProviderInfo[] = []

  const add = (id: string, name: string, modelCount: number, extras?: Partial<ProviderInfo>) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const route = profile[id] ?? {}
    const models = Array.isArray(route.models) ? route.models.length : 0
    const catalogModels = catalog.listModels(id)
    const count = modelCount || models || catalogModels.length
    const hasFree = catalogModels.some(
      (m) => m.costPerInputToken === 0 && m.costPerOutputToken === 0,
    )
    out.push({
      id,
      name: providerDisplayName(id, name),
      supportsOAuth: extras?.supportsOAuth ?? false,
      hasApiKey: keyed.has(id) || keyed.has(dshRouteKey(id)),
      modelCount: count,
      customBaseUrl: typeof route.baseURL === 'string' ? route.baseURL : extras?.customBaseUrl,
      hasFreeModels: hasFree || extras?.hasFreeModels,
    })
  }

  for (const p of catalogProviders) {
    add(p.id, p.name, catalog.listModels(p.id).length, {
      supportsOAuth: p.supportsOAuth,
      customBaseUrl: p.baseUrl,
    })
  }
  for (const id of Object.keys(profile)) {
    const row = profile[id]
    const display = typeof row.displayName === 'string' && row.displayName ? row.displayName : id
    add(id, display, Array.isArray(row.models) ? row.models.length : 0)
  }
  return out
}

export async function listDshModels(providerId: string): Promise<ModelInfo[]> {
  if (!providerId) return []
  const catalog = await ensureDshCatalogReady()
  const catalogModels = catalog.listModels(providerId)
  const profile = sdkProfileDir ? readLlmProviders(sdkProfileDir) : {}
  const route = profile[providerId] ?? {}
  const overrides =
    route.modelOverrides &&
    typeof route.modelOverrides === 'object' &&
    !Array.isArray(route.modelOverrides)
      ? (route.modelOverrides as Record<string, Record<string, unknown>>)
      : {}
  const explicit = Array.isArray(route.models) ? (route.models as Record<string, unknown>[]) : null
  const routeBase =
    typeof route.baseURL === 'string' && route.baseURL
      ? route.baseURL
      : catalog.listProviders().find((p) => p.id === providerId)?.baseUrl || ''

  const byId = new Map<string, ModelInfo>()
  const source =
    explicit && explicit.length > 0
      ? explicit.map((row) => mergeModelRow(row, catalogModels, routeBase, providerId))
      : catalogModels.map((m) => toModelInfo(m, providerId, routeBase))
  for (const model of source) {
    if (model) byId.set(model.id, model)
  }
  for (const [id, over] of Object.entries(overrides)) {
    const base = byId.get(id) ?? catalogModels.find((m) => m.id === id)
    const merged = mergeModelRow(
      { id, ...(base ? modelToRow(base) : {}), ...over },
      catalogModels,
      routeBase,
      providerId,
    )
    if (merged) byId.set(id, merged)
  }
  return [...byId.values()]
}

export function getDshCurrentRoute(): DshDefaultModelSelection | null {
  if (!sdkProfileDir) return null
  return readDefaultModelSelection(sdkProfileDir)
}

/**
 * 对话选择器 / 模型页写入当前路由：官方 agent-default-model + 如有密钥则声明 llm-pi-ai 路由。
 */
export function selectDshRoute(selection: DshDefaultModelSelection): DshDefaultModelSelection {
  if (!sdkProfileDir) {
    throw new Error('DSH sdk profile 尚未装配，无法写入当前模型')
  }
  if (!selection.provider || !selection.model) {
    throw new Error('选择模型需要 provider 与 model')
  }
  const keyed = keyedProviderIds()
  if (keyed.has(selection.provider) || keyed.has(dshRouteKey(selection.provider))) {
    mergeLlmProviderCredentials(sdkProfileDir, {
      [selection.provider]: { apiKeyEnv: dshCredentialEnvName(dshRouteKey(selection.provider)) },
    })
  }
  writeDefaultModelSelection(sdkProfileDir, selection)
  return selection
}

/** 密钥写入 keystore 后，把对应 apiKeyEnv 同步进 profile（不覆盖其它字段）。 */
export function syncDshProviderCredential(providerId: string): void {
  if (!sdkProfileDir || !providerId) return
  mergeLlmProviderCredentials(sdkProfileDir, {
    [providerId]: { apiKeyEnv: dshCredentialEnvName(dshRouteKey(providerId)) },
  })
}

/** 启动子进程时：只把已有密钥的 apiKeyEnv 合并进 profile，不重写 DSH 目录字段。 */
export function syncDshCredentialRoutes(
  profileDir: string,
  credentials: Record<string, { apiKeyEnv?: string }>,
): string {
  return mergeLlmProviderCredentials(profileDir, credentials)
}

function toModelInfo(model: DshCatalogModel, providerId: string, baseUrl: string): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    providerId,
    api: model.api,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    costPerInputToken: model.costPerInputToken,
    costPerOutputToken: model.costPerOutputToken,
    costCacheRead: model.costCacheRead,
    costCacheWrite: model.costCacheWrite,
    supportsReasoning: model.supportsReasoning,
    supportsImage: model.input.includes('image'),
    reasoningLevels: model.reasoningLevels,
    baseUrl: model.baseUrl || baseUrl,
  }
}

function modelToRow(model: DshCatalogModel | ModelInfo): Record<string, unknown> {
  if ('maxTokens' in model) {
    return {
      id: model.id,
      name: model.name,
      api: model.api,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }
  }
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens,
  }
}

function mergeModelRow(
  row: Record<string, unknown>,
  catalog: DshCatalogModel[],
  routeBase: string,
  providerId: string,
): ModelInfo | null {
  const id = typeof row.id === 'string' ? row.id : ''
  if (!id) return null
  const base = catalog.find((m) => m.id === id)
  const name = typeof row.name === 'string' && row.name ? row.name : base?.name || id
  const api = typeof row.api === 'string' && row.api ? row.api : base?.api || 'openai-completions'
  const contextWindow =
    typeof row.contextWindow === 'number' ? row.contextWindow : (base?.contextWindow ?? 1000000)
  const maxTokens =
    typeof row.maxTokens === 'number'
      ? row.maxTokens
      : typeof row.maxOutputTokens === 'number'
        ? row.maxOutputTokens
        : (base?.maxTokens ?? 128000)
  return {
    id,
    name,
    providerId,
    api,
    contextWindow,
    maxOutputTokens: maxTokens,
    costPerInputToken: base?.costPerInputToken ?? 0,
    costPerOutputToken: base?.costPerOutputToken ?? 0,
    costCacheRead: base?.costCacheRead ?? 0,
    costCacheWrite: base?.costCacheWrite ?? 0,
    supportsReasoning:
      typeof row.supportsReasoning === 'boolean'
        ? row.supportsReasoning
        : (base?.supportsReasoning ?? false),
    supportsImage: base?.input.includes('image') ?? false,
    reasoningLevels: base?.reasoningLevels,
    baseUrl:
      typeof row.baseURL === 'string' && row.baseURL ? row.baseURL : base?.baseUrl || routeBase,
    isCustom: !base,
  }
}

export function getDshCatalogSnapshot(): ReturnType<typeof getDshCatalogSource> {
  return getDshCatalogSource()
}
