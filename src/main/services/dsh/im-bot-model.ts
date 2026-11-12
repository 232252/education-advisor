// =============================================================
// 只给还没选模型的渠道机器人补上 dsh-im 自己的 models 字段
//
// 出厂默认是 deepseek-official，凭据名是 DEEPSEEK_API_KEY。教师没配这把
// 钥匙时，没单独选模型的机器人会在「已接收、等待结果」阶段失败，错误码
// MODEL_AUTH。dsh-im 的机器人模型只影响这个机器人的新会话，不改 web
// profile 的 agent-default-model，网页搜索和别的插件仍走它们自己的路由。
// 已经选过模型的机器人保持原样。已绑定的旧会话要由用户发送 /new，这里不删。
// =============================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshRouteKey } from './provider-patch'
import type { DshDefaultModelSelection } from './provider-profile-patch'

const BOT_ID = /^[A-Za-z0-9_-]{1,128}$/

export function credentialedRouteIds(
  envNames: Record<string, string>,
  injected: Record<string, string>,
): Set<string> {
  const routes = new Set<string>()
  for (const [envName, providerId] of Object.entries(envNames)) {
    if (!injected[envName]) continue
    const route = dshRouteKey(providerId)
    if (route) routes.add(route)
  }
  return routes
}

export function fillUnsetBotModels(opts: {
  home: string
  selection: DshDefaultModelSelection | null
  credentialedRoutes: ReadonlySet<string>
}): { filled: number } {
  const selection = normalizedSelection(opts.selection, opts.credentialedRoutes)
  if (!selection) return { filled: 0 }
  const integrations = join(opts.home, 'integrations')
  if (!existsSync(integrations)) return { filled: 0 }
  let filled = 0
  for (const path of workspaceFiles(integrations)) {
    filled += fillFile(path, selection)
  }
  if (filled > 0) {
    console.warn(
      `[dsh-im] 已为 ${filled} 个还没选模型的机器人写入 ${selection.provider}/${selection.model}。已有会话请发送 /new。`,
    )
  }
  return { filled }
}

function normalizedSelection(
  selection: DshDefaultModelSelection | null,
  credentialedRoutes: ReadonlySet<string>,
): DshDefaultModelSelection | null {
  if (!selection?.provider || !selection.model) return null
  const route = dshRouteKey(selection.provider)
  if (!credentialedRoutes.has(route) && !credentialedRoutes.has(selection.provider)) return null
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
  }
}

function workspaceFiles(dir: string): string[] {
  const found: string[] = []
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...workspaceFiles(full))
    else if (entry.isFile() && entry.name === 'workspaces.json') found.push(full)
  }
  return found
}

function fillFile(path: string, selection: DshDefaultModelSelection): number {
  let state: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0
    state = parsed as Record<string, unknown>
  } catch (err) {
    console.warn(`[dsh-im] 跳过无法读取的机器人工作区 ${path}:`, err)
    return 0
  }
  const workspaces = state.workspaces
  if (!workspaces || typeof workspaces !== 'object' || Array.isArray(workspaces)) return 0
  const models =
    state.models && typeof state.models === 'object' && !Array.isArray(state.models)
      ? (state.models as Record<string, unknown>)
      : {}
  let filled = 0
  for (const botId of Object.keys(workspaces)) {
    if (!BOT_ID.test(botId) || models[botId]) continue
    models[botId] = { ...selection }
    filled += 1
  }
  if (filled === 0) return 0
  state.models = models
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return filled
}
