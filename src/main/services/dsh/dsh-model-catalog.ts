// =============================================================
// DSH 官方模型目录（随包运行时里的 pi-ai catalog）
//
// 数据来源是 dsh-runtime 中与 llm-pi-ai 同一份 @earendil-works/pi-ai，
// 不是教育参谋自己再维护的一份平行目录。单测通过 configureDshCatalogSource 注入。
// =============================================================

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface DshCatalogProvider {
  id: string
  name: string
  baseUrl?: string
  supportsOAuth?: boolean
}

export interface DshCatalogModel {
  id: string
  name: string
  api: string
  contextWindow: number
  maxTokens: number
  input: string[]
  supportsReasoning: boolean
  reasoningLevels?: string[]
  costPerInputToken: number
  costPerOutputToken: number
  costCacheRead: number
  costCacheWrite: number
  baseUrl: string
}

export interface DshCatalogSource {
  listProviders(): DshCatalogProvider[]
  listModels(providerId: string): DshCatalogModel[]
}

let injected: DshCatalogSource | null = null
let catalogGeneration = 0
let settledGeneration = -1

/** 单测或宿主装配时注入；传 null 恢复为读取运行时目录。 */
export function configureDshCatalogSource(source: DshCatalogSource | null): void {
  injected = source
}

/**
 * 官方目录是否已经读完。没读完时 listModels 会暂时是空的，
 * 不能据此判断「这条路由没有目录」然后把 models 写进 profile。
 */
export function isDshCatalogSettled(): boolean {
  return injected !== null || settledGeneration === catalogGeneration
}

export function getDshCatalogSource(): DshCatalogSource {
  if (injected) return injected
  return loadRuntimeCatalog()
}

/** dsh-runtime 根目录（含 node_modules/@earendil-works/pi-ai）。由 configureDshRuntime 注入。 */
let runtimeRoot = ''

export function configureDshCatalogRoot(root: string): void {
  if (root === runtimeRoot) return
  runtimeRoot = root
  cached = null
  cachedRoot = null
}

/** Official catalog root (directory that contains node_modules/@earendil-works/pi-ai). */
export function getDshCatalogRoot(): string {
  return runtimeRoot
}

interface PiProvider {
  id?: string
  name?: string
  baseUrl?: string
  auth?: { oauth?: unknown }
  getModels?: () => readonly Record<string, unknown>[]
}

interface BuiltinModule {
  builtinProviders?: () => readonly PiProvider[]
}

let cached: DshCatalogSource | null = null
let cachedRoot: string | null = null

function loadRuntimeCatalog(): DshCatalogSource {
  const root = runtimeRoot
  if (!root) {
    return { listProviders: () => [], listModels: () => [] }
  }
  if (cached && cachedRoot === root) return cached
  const generation = ++catalogGeneration
  const allJs = join(
    root,
    'node_modules',
    '@earendil-works',
    'pi-ai',
    'dist',
    'providers',
    'all.js',
  )
  if (!existsSync(allJs)) {
    console.warn(`[dsh-model-catalog] official pi-ai catalog missing at ${allJs}`)
    const empty: DshCatalogSource = { listProviders: () => [], listModels: () => [] }
    cached = empty
    cachedRoot = root
    return empty
  }
  // 同步接口给 UI 列表用；模块按 ESM 绝对路径加载，失败时退回空目录而不是改走 EAA 平行表。
  let providers: DshCatalogProvider[] = []
  let modelsById = new Map<string, DshCatalogModel[]>()
  const ready = import(pathToFileURL(allJs).href)
    .then((mod: BuiltinModule) => {
      const list = typeof mod.builtinProviders === 'function' ? [...mod.builtinProviders()] : []
      const nextProviders: DshCatalogProvider[] = []
      const nextModels = new Map<string, DshCatalogModel[]>()
      for (const p of list) {
        if (!p || typeof p.id !== 'string' || !p.id) continue
        nextProviders.push({
          id: p.id,
          name: typeof p.name === 'string' && p.name ? p.name : p.id,
          baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
          supportsOAuth: Boolean(p.auth?.oauth),
        })
        const raw = typeof p.getModels === 'function' ? p.getModels() : []
        nextModels.set(
          p.id,
          raw.map(toCatalogModel).filter((m): m is DshCatalogModel => m !== null),
        )
      }
      providers = nextProviders
      modelsById = nextModels
      if (generation === catalogGeneration) settledGeneration = generation
    })
    .catch((err: unknown) => {
      console.warn('[dsh-model-catalog] failed to import official pi-ai catalog:', err)
    })
  // 首次调用时模块可能尚未 settle；list* 读当前快照，后续 IPC 再取即可。
  void ready
  const source: DshCatalogSource = {
    listProviders: () => providers,
    listModels: (providerId: string) => modelsById.get(providerId) ?? [],
  }
  // 同步预热：调用方若需要完整列表，应使用 ensureDshCatalogReady()。
  cached = source
  cachedRoot = root
  ;(source as DshCatalogSource & { ready?: Promise<void> }).ready = ready
  return source
}

export async function ensureDshCatalogReady(): Promise<DshCatalogSource> {
  if (injected) return injected
  const source = loadRuntimeCatalog()
  const ready = (source as DshCatalogSource & { ready?: Promise<void> }).ready
  if (ready) await ready
  return source
}

function toCatalogModel(raw: Record<string, unknown>): DshCatalogModel | null {
  if (typeof raw.id !== 'string' || !raw.id) return null
  const cost = (raw.cost && typeof raw.cost === 'object' ? raw.cost : {}) as Record<string, unknown>
  const input = Array.isArray(raw.input) ? raw.input.map((x) => String(x)) : ['text']
  const reasoning = raw.reasoning
  const supportsReasoning =
    reasoning === true || (reasoning !== false && reasoning != null && reasoning !== 'off')
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    api: typeof raw.api === 'string' && raw.api ? raw.api : 'openai-completions',
    contextWindow: num(raw.contextWindow, 1000000),
    maxTokens: num(raw.maxTokens, 128000),
    input,
    supportsReasoning,
    reasoningLevels: Array.isArray((raw as { reasoningLevels?: unknown }).reasoningLevels)
      ? (raw as { reasoningLevels: unknown[] }).reasoningLevels.map((x) => String(x))
      : undefined,
    costPerInputToken: num(cost.input, 0),
    costPerOutputToken: num(cost.output, 0),
    costCacheRead: num(cost.cacheRead, 0),
    costCacheWrite: num(cost.cacheWrite, 0),
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
