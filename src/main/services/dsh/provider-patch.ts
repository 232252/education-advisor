// =============================================================
// 让 dsh 子进程用上 app 自己存的 API Key
//
// 为什么必须有它：dsh 的模型路由不是内置枚举。`dsh --profile sdk` 的 roster 里
// llm-pi-ai 行处于「休眠姿态」（providers 缺省 → 注册 0 条路由，
// packages/llm/llm-pi-ai/src/index.ts:161 resolveProfiles），因此 app 按 pi 的
// provider id 传 initialize({provider:'deepseek'}) 时报 no adapter registered；
// 唯一的例外是 dsh-base 的 llm-deepseek 行，它注册的路由名写死为
// deepseek-official（packages/llm/llm-deepseek/src/index.ts:57），凭据取自
// DEEPSEEK_API_KEY（实测 MISSING_CREDENTIAL 的提示文本）。
//
// 怎么绕过「要用户去配 dsh」：providers 的 dict key 就是路由名（config.ts:90），
// 且只带 apiKeyEnv 的路由沿用同版本 pi-ai 的现成 catalog（config.ts:470-490
// buildProvider 只用 source.api/baseURL/models，models 省略即 installed catalog）。
// 于是 app 可以替用户把「它有 key 的那些 provider」声明成同名路由，key 本身
// 不进 patch 文件 —— patch 只写变量名，值由 HarnessClientOptions.env 注入子进程。
//
// env 的坑：SDK 的 env 是**整体替换**父进程环境（不是合并），所以要么不传，
// 要么传完整的 {...process.env, ...}；这里只在确实有 key 要带时才传。
// =============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { EaaCordisPatchRow } from './hardening'
import { applyDshRoute } from './route-names'

export const EAA_PROVIDER_PATCH_FILE = 'eaa-llm-providers.cordis.patch.yml'

/**
 * 凭据与改名表都由 bootstrap 注入，而不是这里静态 import keystore-service /
 * settings-service：两者都拉着 electron（utils/log/state.ts 在模块顶层就
 * app.getPath），而 dsh/* 的单测跑在无 electron 的 node 项目里。
 */
export interface DshCredentialSource {
  listProviders(): string[]
  getApiKey(provider: string): string | undefined
  /** settings.models.dshRoutes 的内容；省略即没有用户改名 */
  dshRoutes?(): Record<string, string> | undefined
}

let credentialSource: DshCredentialSource | null = null

export function configureDshCredentials(source: DshCredentialSource | null): void {
  credentialSource = source
}

/**
 * dsh-base 里已由别的适配器占用的路由名 → 该适配器认的凭据变量名。
 * 这些路由不能再交给 llm-pi-ai 声明（同一进程两条路由抢同一个名字），只需要把
 * 它要的变量放进子进程环境。
 */
const DSH_NATIVE_ROUTES: Readonly<Record<string, string>> = {
  'deepseek-official': 'DEEPSEEK_API_KEY',
}

/** dsh 侧 credentialRef 的语法：/^[A-Za-z_][A-Za-z0-9_]*$/（packages/credentials/credentials/src/index.ts:19） */
const ENV_NAME_FORBIDDEN = /[^A-Za-z0-9_]/g

/** 由路由名推出注入用的环境变量名，保证落在 dsh 的 credentialRef 语法内 */
export function dshCredentialEnvName(routeId: string): string {
  const cleaned = routeId.replace(ENV_NAME_FORBIDDEN, '_').replace(/^[0-9_]+/, '')
  return `EAA_DSH_${cleaned.toUpperCase() || 'ROUTE'}_API_KEY`
}

export interface DshProviderRouting {
  /** 交给 llm-pi-ai 行的 providers dict：路由名 → { apiKeyEnv }（不含任何密钥值） */
  profiles: Record<string, { apiKeyEnv: string }>
  /** 注入子进程的环境变量名 → 该变量要放的 keystore provider id */
  envNames: Record<string, string>
}

/**
 * 为一批 pi provider id 算出 dsh 侧的路由声明与凭据变量。
 * 路由名走 dshRouteFor（settings.models.dshRoutes 可以改名），因此用户把
 * provider 映射到自己声明过的 key 时，这里声明的是那个名字，不会撞车。
 */
export function dshProviderRouting(providerIds: readonly string[]): DshProviderRouting {
  const profiles: Record<string, { apiKeyEnv: string }> = {}
  const envNames: Record<string, string> = {}
  for (const providerId of providerIds) {
    if (!providerId) continue
    const { providerId: route } = applyDshRoute(providerId, '', routeOverrides())
    const nativeEnv = DSH_NATIVE_ROUTES[route]
    const envName = nativeEnv ?? dshCredentialEnvName(route)
    if (!nativeEnv) profiles[route] = { apiKeyEnv: envName }
    envNames[envName] = providerId
  }
  return { profiles, envNames }
}

/** 用户改名表；读不到就按「没有改名」处理 */
function routeOverrides(): Record<string, string> | undefined {
  try {
    return credentialSource?.dshRoutes?.()
  } catch (err) {
    console.warn('[dsh] dshRoutes unreadable, using pi provider ids as routes:', err)
    return undefined
  }
}

/** 当前存过 key 的 provider（未注入凭据来源或读取失败按空处理，不能因此打断子进程启动） */
export function providersWithKeys(): string[] {
  try {
    return credentialSource?.listProviders() ?? []
  } catch (err) {
    console.warn('[dsh] keystore unreadable, launching without credential injection:', err)
    return []
  }
}

export function buildEaaProviderPatchRows(
  profiles: DshProviderRouting['profiles'],
): EaaCordisPatchRow[] {
  return [{ id: 'llm-pi-ai', config: { providers: profiles } }]
}

/**
 * 落盘并返回路径；没有路由要声明时返回 null，让 createDshRuntime 直接不带这层。
 * 必须能「不带」：patch 的 config 是整行覆盖而不是合并，写一份空 providers 会把
 * 用户自己在 dsh 侧声明过的路由抹掉。
 * 与 hardening 同样的同步写法 + 内容一致不重写；patch 里只有变量名，没有密钥。
 */
export function ensureEaaProviderPatch(
  patchDir: string,
  profiles: DshProviderRouting['profiles'],
): string | null {
  const ids = Object.keys(profiles)
  if (!ids.length) return null
  const patchPath = join(patchDir, EAA_PROVIDER_PATCH_FILE)
  const picked: DshProviderRouting['profiles'] = {}
  for (const id of ids.sort()) picked[id] = profiles[id]
  const text = stringify(buildEaaProviderPatchRows(picked), { lineWidth: 0 })
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}

/**
 * 子进程环境：SDK 的 env 会整体替换父环境，所以这里显式带上父环境再叠 key。
 * 没有 key 可注入时返回 undefined —— 保持 SDK 自己的环境继承行为（含 dsh 从
 * 用户环境里读 DEEPSEEK_API_KEY 之类的路子）。
 */
export function dshSubprocessEnv(
  envNames: Record<string, string>,
  readKey: (providerId: string) => string | undefined = (p) => credentialSource?.getApiKey(p),
): Record<string, string> | undefined {
  const extra: Record<string, string> = {}
  for (const [envName, providerId] of Object.entries(envNames)) {
    const key = readKey(providerId)
    if (key) extra[envName] = key
  }
  if (!Object.keys(extra).length) return undefined
  return { ...(process.env as Record<string, string>), ...extra }
}
