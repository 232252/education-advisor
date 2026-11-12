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
import type { DshProviderRouting } from './provider-patch'

export const EAA_PROFILE_LLM_ROW_ID = 'llm-pi-ai'
export const EAA_PROFILE_PATCH_FILE = 'cordis.patch.yml'

const HEADER = `# EAA 会把 llm-pi-ai 的 providers 写进这一层。不要在本文件里写密钥。
`

type PatchRow = Record<string, unknown>

function sortProfiles(
  providers: DshProviderRouting['profiles'],
): DshProviderRouting['profiles'] {
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
    const nextRow: PatchRow = {
      id: EAA_PROFILE_LLM_ROW_ID,
      config: { providers: sortProfiles(providers) },
    }
    if (existing >= 0) rows[existing] = nextRow
    else rows.push(nextRow)
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
  const next: PatchRow = { id, config }
  const index = rows.findIndex((row) => rowId(row) === id)
  if (index >= 0) rows[index] = next
  else rows.push(next)
  return rows
}

/** 读取 profile 层 llm-pi-ai 的 providers 字典；没有该行则空对象。 */
export function readLlmProviders(profileDir: string): Record<string, Record<string, unknown>> {
  const rows = readProfilePatchRows(profileDir)
  const row = rows.find((item) => rowId(item) === EAA_PROFILE_LLM_ROW_ID)
  const config = row && typeof row.config === 'object' && row.config ? (row.config as Record<string, unknown>) : {}
  const providers = config.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, value] of Object.entries(providers as Record<string, unknown>)) {
    if (!id) continue
    out[id] = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
  }
  return out
}

/**
 * 把凭据环境变量名合并进已有的 llm-pi-ai providers。
 * 只补 apiKeyEnv，不覆盖 DSH 侧已有的 models / api / baseURL 等字段，也不删除教师已声明的路由。
 */
export function mergeLlmProviderCredentials(
  profileDir: string,
  credentials: Record<string, { apiKeyEnv?: string }>,
): string {
  mkdirSync(profileDir, { recursive: true })
  const rows = readProfilePatchRows(profileDir)
  const providers = readLlmProviders(profileDir)
  let changed = false
  for (const [id, cred] of Object.entries(credentials)) {
    if (!id || !cred.apiKeyEnv) continue
    const existing = providers[id] ?? {}
    if (existing.apiKeyEnv === cred.apiKeyEnv) {
      if (!providers[id]) {
        providers[id] = { ...existing, apiKeyEnv: cred.apiKeyEnv }
        changed = true
      }
      continue
    }
    providers[id] = { ...existing, apiKeyEnv: cred.apiKeyEnv }
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
  upsertRow(rows, EAA_PROFILE_LLM_ROW_ID, { providers: sortProfiles(providers as never) })
  return writePatchRows(profileDir, rows)
}

/** 读取官方 agent-default-model 行，没有则返回 null。 */
export function readDefaultModelSelection(profileDir: string): DshDefaultModelSelection | null {
  const rows = readProfilePatchRows(profileDir)
  const row = rows.find((item) => rowId(item) === EAA_PROFILE_DEFAULT_MODEL_ROW_ID)
  const config = row && typeof row.config === 'object' && row.config ? (row.config as Record<string, unknown>) : null
  if (!config) return null
  const provider = typeof config.provider === 'string' ? config.provider : ''
  const model = typeof config.model === 'string' ? config.model : ''
  if (!provider && !model) return null
  const reasoningEffort = typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined
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
