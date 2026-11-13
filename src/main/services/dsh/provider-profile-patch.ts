// =============================================================
// 把 llm-pi-ai 的路由声明写进官方 profile 层
//
// 官方加载顺序是 bundle → profile 的 cordis.patch.yml → 命令行 --patch。
// llm-pi-ai 在 apply() 时读取 config.providers 并 registerAdapter。
// 宿主原先把同一份声明放在 spawn 时的 --patch 里，命令行已带上文件，
// 但 initialize 仍报 no adapter registered。因此改走官方 profile 层，
// 让这条配置在插件启动时就已经在行上。
//
// 只写环境变量名，不写密钥。其它 profile 行（例如 web 的欢迎说明）保留。
// =============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { getDshCatalogSource, isDshCatalogSettled } from './dsh-model-catalog'
import {
  type DshRouteModelEntry,
  type DshRouteModelSource,
  dshRouteModelEntry,
} from './profile-overrides'
import type { DshProviderRouting, DshRouteProfile } from './provider-patch'

export const EAA_PROFILE_LLM_ROW_ID = 'llm-pi-ai'
export const EAA_PROFILE_PATCH_FILE = 'cordis.patch.yml'

const HEADER = `# EAA 会把 llm-pi-ai 的 providers 写进这一层。不要在本文件里写密钥。
`

type PatchRow = Record<string, unknown>

function sortProfiles(providers: DshProviderRouting['profiles']): DshProviderRouting['profiles'] {
  const ids = Object.keys(providers).sort()
  const picked: DshProviderRouting['profiles'] = {}
  for (const id of ids) picked[id] = providers[id]
  return picked
}

function readPatchRows(patchPath: string): PatchRow[] {
  if (!existsSync(patchPath)) return []
  const raw = readFileSync(patchPath, 'utf8')
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch (err) {
    throw new Error(`无法解析 profile 补丁 ${patchPath}: ${String(err)}`)
  }
  if (parsed == null) return []
  if (!Array.isArray(parsed)) {
    throw new Error(`profile 补丁必须是 YAML 数组：${patchPath}`)
  }
  return parsed.filter((row): row is PatchRow => !!row && typeof row === 'object')
}

function rowId(row: PatchRow): string | undefined {
  return typeof row.id === 'string' ? row.id : undefined
}

function sameText(left: string, right: string): boolean {
  return left.replace(/\r\n/g, '\n') === right.replace(/\r\n/g, '\n')
}

/**
 * 把当前要声明的 providers 合并进 profile 的 cordis.patch.yml。
 * providers 为空时，去掉本应用写入的 llm-pi-ai 行，不碰其它行。
 * 返回补丁路径。
 */
export function ensureEaaProviderProfilePatch(
  profileDir: string,
  providers: DshProviderRouting['profiles'],
): string {
  mkdirSync(profileDir, { recursive: true })
  const patchPath = join(profileDir, EAA_PROFILE_PATCH_FILE)
  const rows = readPatchRows(patchPath)
  const existing = rows.findIndex((row) => rowId(row) === EAA_PROFILE_LLM_ROW_ID)
  const ids = Object.keys(providers)
  if (ids.length === 0) {
    if (existing >= 0) rows.splice(existing, 1)
  } else {
    const config = llmConfig(rows, providers)
    if (existing >= 0) rows[existing] = { ...rows[existing], id: EAA_PROFILE_LLM_ROW_ID, config }
    else rows.push({ id: EAA_PROFILE_LLM_ROW_ID, config })
  }
  const text = `${HEADER}${stringify(rows, { lineWidth: 0 })}`
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (!current || !sameText(current, text)) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}

export const EAA_PROFILE_DEFAULT_MODEL_ROW_ID = 'agent-default-model'

export interface DshDefaultModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export function readProfilePatchRows(profileDir: string): PatchRow[] {
  return readPatchRows(join(profileDir, EAA_PROFILE_PATCH_FILE))
}

function writePatchRows(profileDir: string, rows: PatchRow[]): string {
  mkdirSync(profileDir, { recursive: true })
  const patchPath = join(profileDir, EAA_PROFILE_PATCH_FILE)
  const text = `${HEADER}${stringify(rows, { lineWidth: 0 })}`
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (!current || !sameText(current, text)) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}

function upsertRow(rows: PatchRow[], id: string, config: Record<string, unknown>): PatchRow[] {
  const index = rows.findIndex((row) => rowId(row) === id)
  if (index >= 0) rows[index] = { ...rows[index], id, config }
  else rows.push({ id, config })
  return rows
}

/** 换掉 providers 时留下 llm-pi-ai 配置上的其它字段。 */
function llmConfig(
  rows: PatchRow[],
  providers: DshProviderRouting['profiles'],
): Record<string, unknown> {
  const row = rows.find((item) => rowId(item) === EAA_PROFILE_LLM_ROW_ID)
  const existing =
    row?.config && typeof row.config === 'object' && !Array.isArray(row.config)
      ? { ...(row.config as Record<string, unknown>) }
      : {}
  return { ...existing, providers: sortProfiles(providers) }
}

/** 读取 profile 层 llm-pi-ai 的整段 config。没有该行则 undefined。 */
export function readLlmRowConfig(profileDir: string): Record<string, unknown> | undefined {
  if (!profileDir) return undefined
  const rows = readProfilePatchRows(profileDir)
  const row = rows.find((item) => rowId(item) === EAA_PROFILE_LLM_ROW_ID)
  if (!row?.config || typeof row.config !== 'object' || Array.isArray(row.config)) return undefined
  return { ...(row.config as Record<string, unknown>) }
}

/**
 * 连接测试的 --patch 会换掉整行 config。从磁盘上的配置出发，
 * 只给还没有的路由补字段；被测试的那条路由把 apiKeyEnv 指到这次注入的变量。
 * 已有的 models 不被内存里的钉住条目换掉。
 */
export function mergeProbeLlmConfig(
  diskConfig: Record<string, unknown> | undefined,
  forced: DshProviderRouting['profiles'],
  probe: { route: string; envName: string },
): Record<string, unknown> {
  const base = diskConfig ? { ...diskConfig } : {}
  const diskProviders =
    base.providers && typeof base.providers === 'object' && !Array.isArray(base.providers)
      ? { ...(base.providers as Record<string, Record<string, unknown>>) }
      : {}
  const next: Record<string, Record<string, unknown>> = {}
  for (const [id, value] of Object.entries(diskProviders)) next[id] = { ...value }
  for (const [id, profile] of Object.entries(forced)) {
    const existing = { ...(next[id] ?? {}) }
    const fill = profileRouteFill(profile)
    for (const [key, value] of Object.entries(fill)) {
      if (value === undefined || value === '') continue
      if (!routeFieldPresent(existing[key])) existing[key] = value
    }
    if (!existing.models && profile.models) existing.models = profile.models
    if (!existing.api && profile.api) existing.api = profile.api
    if (id === probe.route) existing.apiKeyEnv = probe.envName
    next[id] = existing
  }
  const ids = Object.keys(next).sort()
  const providers: Record<string, Record<string, unknown>> = {}
  for (const id of ids) providers[id] = next[id]
  return { ...base, providers }
}

/** 读取 profile 层 llm-pi-ai 的 providers 字典；没有该行则空对象。 */
export function readLlmProviders(profileDir: string): Record<string, Record<string, unknown>> {
  const rows = readProfilePatchRows(profileDir)
  const row = rows.find((item) => rowId(item) === EAA_PROFILE_LLM_ROW_ID)
  const config =
    row && typeof row.config === 'object' && row.config
      ? (row.config as Record<string, unknown>)
      : {}
  const providers = config.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, value] of Object.entries(providers as Record<string, unknown>)) {
    if (!id) continue
    out[id] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {}
  }
  return out
}

const ROUTE_FILL_KEYS = [
  'apiKeyEnv',
  'baseURL',
  'timeoutMs',
  'cacheRetention',
  'retryPolicy',
] as const

const DEFAULT_RETRY = {
  mode: 'normal' as const,
  maxRetries: 3,
  backoff: { initialDelayMs: 1000 },
}

/** 从内存里的路由声明取出可以补进 profile 的字段。不含 models，也不含默认重试。 */
export function profileRouteFill(profile: DshRouteProfile): Partial<DshRouteProfile> {
  const fill: Partial<DshRouteProfile> = {}
  if (profile.apiKeyEnv) fill.apiKeyEnv = profile.apiKeyEnv
  if (profile.baseURL) fill.baseURL = profile.baseURL
  if (typeof profile.timeoutMs === 'number') fill.timeoutMs = profile.timeoutMs
  if (profile.cacheRetention) fill.cacheRetention = profile.cacheRetention
  const retry = profile.retryPolicy
  if (
    retry &&
    (retry.mode !== DEFAULT_RETRY.mode ||
      retry.maxRetries !== DEFAULT_RETRY.maxRetries ||
      retry.backoff.initialDelayMs !== DEFAULT_RETRY.backoff.initialDelayMs)
  ) {
    fill.retryPolicy = retry
  }
  return fill
}

function routeFieldPresent(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return value !== null && typeof value === 'object'
}

/**
 * 把凭据名和路由级覆盖合并进已有的 llm-pi-ai providers。
 * 只补缺的 apiKeyEnv、baseURL、超时、缓存和明确改过的重试。
 * 不覆盖 DSH 已经写过的这些字段，不写 models，也不删除已有路由。
 */
export function mergeLlmProviderCredentials(
  profileDir: string,
  credentials: Record<string, Partial<DshRouteProfile>>,
): string {
  mkdirSync(profileDir, { recursive: true })
  const rows = readProfilePatchRows(profileDir)
  const providers = readLlmProviders(profileDir)
  let changed = false
  for (const [id, cred] of Object.entries(credentials)) {
    if (!id) continue
    const existing = providers[id] ?? {}
    const next = { ...existing }
    let rowChanged = false
    for (const key of ROUTE_FILL_KEYS) {
      const value = cred[key]
      if (value === undefined || value === '') continue
      // DSH 模型页或已有 profile 写过的字段不再改写。教师端只在缺项时补上。
      if (routeFieldPresent(existing[key])) continue
      next[key] = value
      rowChanged = true
    }
    if (!rowChanged) continue
    providers[id] = next
    changed = true
  }
  if (!changed && Object.keys(credentials).length > 0) {
    // 仍可能是首次写入（空文件且凭据与现有一致不会发生）；若行还不存在需要建行。
    const hasRow = rows.some((row) => rowId(row) === EAA_PROFILE_LLM_ROW_ID)
    if (hasRow && Object.keys(providers).length > 0) return join(profileDir, EAA_PROFILE_PATCH_FILE)
  }
  const ids = Object.keys(providers)
  if (ids.length === 0) {
    const existing = rows.findIndex((row) => rowId(row) === EAA_PROFILE_LLM_ROW_ID)
    if (existing >= 0) rows.splice(existing, 1)
    return writePatchRows(profileDir, rows)
  }
  upsertRow(rows, EAA_PROFILE_LLM_ROW_ID, llmConfig(rows, providers as never))
  return writePatchRows(profileDir, rows)
}

/**
 * 官方目录不描述这条路由时，把当前要用的模型补进 profile。
 * 目录里已有模型的路由不写 models，避免换成一份冻结目录，把其它插件的模型盖掉。
 * 已经列过的 id 不重复。api 只在路由还没有时补上。
 */
export function mergeUncataloguedRouteModel(
  profileDir: string,
  route: string,
  entry: DshRouteModelEntry,
  api?: string,
): string {
  if (!route || !entry.id) return join(profileDir, EAA_PROFILE_PATCH_FILE)
  mkdirSync(profileDir, { recursive: true })
  const rows = readProfilePatchRows(profileDir)
  const providers = readLlmProviders(profileDir)
  const existing = providers[route] ?? {}
  const listed = Array.isArray(existing.models) ? existing.models : []
  const models = listed.filter((item) => item && typeof item === 'object')
  const hasId = models.some((item) => (item as { id?: unknown }).id === entry.id)
  const next = { ...existing }
  let changed = false
  if (!hasId) {
    next.models = [...models, entry]
    changed = true
  }
  if (api && !routeFieldPresent(existing.api)) {
    next.api = api
    changed = true
  }
  if (!changed) return join(profileDir, EAA_PROFILE_PATCH_FILE)
  providers[route] = next
  upsertRow(rows, EAA_PROFILE_LLM_ROW_ID, llmConfig(rows, providers as never))
  return writePatchRows(profileDir, rows)
}

/**
 * 目录已经读完时，给目录里没有的路由补上这些模型。
 * 同一条路由的多个模型都留下。目录里已有模型的路由整段跳过。
 */
export function syncUncataloguedRouteModels(
  profileDir: string,
  picks: readonly { provider: string; model: string }[],
  describe: (route: string, modelId: string) => DshRouteModelSource | undefined,
): void {
  if (!isDshCatalogSettled()) return
  const catalog = getDshCatalogSource()
  const seen = new Set<string>()
  for (const pick of picks) {
    if (!pick.provider || !pick.model) continue
    const key = `${pick.provider}\0${pick.model}`
    if (seen.has(key)) continue
    seen.add(key)
    if (catalog.listModels(pick.provider).length > 0) continue
    const source = describe(pick.provider, pick.model)
    const entry = dshRouteModelEntry(source ?? { id: pick.model })
    if (!entry) continue
    mergeUncataloguedRouteModel(profileDir, pick.provider, entry, source?.api)
  }
}

/**
 * 把 profile 里已经写好的 apiKeyEnv 并进启动环境表。
 * 值仍是 keystore 的 provider id（从本次声明的 EAA 变量名反查），
 * 这样 DSH 保存的 `MINIMAX_CN_API_KEY` 会注入钥匙，而不是只注入 EAA 前缀名。
 * 官方名已被别的 provider 占用时不覆盖。
 */
export function withProfileCredentialRefs(
  envNames: Record<string, string>,
  declaredProfiles: Record<string, { apiKeyEnv?: string }>,
  storedProviders: Record<string, Record<string, unknown>>,
): Record<string, string> {
  const next = { ...envNames }
  for (const [route, stored] of Object.entries(storedProviders)) {
    const ref = stored.apiKeyEnv
    if (typeof ref !== 'string' || !ref) continue
    const declaredRef = declaredProfiles[route]?.apiKeyEnv
    const providerId = declaredRef ? envNames[declaredRef] : undefined
    if (!providerId) continue
    if (next[ref] !== undefined && next[ref] !== providerId) continue
    next[ref] = providerId
  }
  return next
}

/** 读取官方 agent-default-model 行，没有则返回 null。 */
export function readDefaultModelSelection(profileDir: string): DshDefaultModelSelection | null {
  const rows = readProfilePatchRows(profileDir)
  const row = rows.find((item) => rowId(item) === EAA_PROFILE_DEFAULT_MODEL_ROW_ID)
  const config =
    row && typeof row.config === 'object' && row.config
      ? (row.config as Record<string, unknown>)
      : null
  if (!config) return null
  const provider = typeof config.provider === 'string' ? config.provider : ''
  const model = typeof config.model === 'string' ? config.model : ''
  if (!provider && !model) return null
  const reasoningEffort =
    typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined
  return { provider, model, reasoningEffort }
}

/** 把当前对话路由写回官方 agent-default-model 行。不写密钥。 */
export function writeDefaultModelSelection(
  profileDir: string,
  selection: DshDefaultModelSelection,
): string {
  if (!selection.provider || !selection.model) {
    throw new Error('DSH default model 需要同时提供 provider 与 model')
  }
  const rows = readProfilePatchRows(profileDir)
  const config: Record<string, unknown> = {
    provider: selection.provider,
    model: selection.model,
  }
  if (selection.reasoningEffort) config.reasoningEffort = selection.reasoningEffort
  upsertRow(rows, EAA_PROFILE_DEFAULT_MODEL_ROW_ID, config)
  return writePatchRows(profileDir, rows)
}
