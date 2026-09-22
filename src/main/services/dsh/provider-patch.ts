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
// 除凭据外还要把 app 侧的路由级配置一起写进去（Base URL / retry / cacheRetention，
// 见 profile-overrides.ts）：那些设置在 pi 后端是主进程内存里生效的，换成子进程后
// 不写就等于静默丢掉。
//
// env 的坑：SDK 的 env 是**整体替换**父进程环境（不是合并），所以要么不传，
// 要么传完整的 {...process.env, ...}；这里只在确实有 key 要带时才传。
// =============================================================

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { EaaCordisPatchRow } from './hardening'
import {
  type DshModelsSettingsSlice,
  type DshRouteModelEntry,
  type DshRouteProfileOverrides,
  dshRouteProfileOverrides,
  providersWithCustomModels,
} from './profile-overrides'
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
  /**
   * settings.models 的可切片读取（Base URL / retry / cacheRetention / customModels）。
   * 省略即「没有路由级覆盖」，patch 回到只带 apiKeyEnv 的旧形态。
   */
  modelsSettings?(): DshModelsSettingsSlice | undefined
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
  /**
   * 交给 llm-pi-ai 行的 providers dict：路由名 → 该路由的配置。
   * apiKeyEnv 只在 app 存有 key 时出现；baseURL/retryPolicy/timeoutMs/
   * cacheRetention 来自 settings（见 profile-overrides.ts）。任何密钥值都不进这里。
   */
  profiles: Record<string, DshRouteProfile>
  /** 注入子进程的环境变量名 → 该变量要放的 keystore provider id */
  envNames: Record<string, string>
}

/** 一条路由在 patch 里的形态 */
export type DshRouteProfile = {
  apiKeyEnv?: string
  models?: DshRouteModelEntry[]
} & DshRouteProfileOverrides

/**
 * 为一批 pi provider id 算出 dsh 侧的路由声明与凭据变量。
 * 路由名走 dshRouteFor（settings.models.dshRoutes 可以改名），因此用户把
 * provider 映射到自己声明过的 key 时，这里声明的是那个名字，不会撞车。
 *
 * pinned 是给「本次子进程 initialize 要钉住的那条路由」补模型条目用的：
 * dsh 的 llm-pi-ai 路由不会沿用 pi 的现成目录（实测：不写 models 就是
 * `has no configured model`）。一个子进程只钉一个模型，所以只需这一条。
 */
export function dshProviderRouting(
  providerIds: readonly string[],
  pinned?: { route: string; entry: DshRouteModelEntry },
): DshProviderRouting {
  const profiles: Record<string, DshRouteProfile> = {}
  const envNames: Record<string, string> = {}
  const models = modelsSlice()
  // 一次读取集合，别按 provider 逐个去解密密钥
  const keyed = new Set(providersWithKeys())
  for (const providerId of providerIds) {
    if (!providerId) continue
    const overrides = dshRouteProfileOverrides(models, providerId)
    const { providerId: route } = applyDshRoute(providerId, '', routeOverrides(), {
      customEndpoint: overrides.baseURL !== undefined,
    })
    const nativeEnv = DSH_NATIVE_ROUTES[route]
    const envName = nativeEnv ?? dshCredentialEnvName(route)
    if (!nativeEnv) {
      const profile: DshRouteProfile = { ...overrides }
      // 没存 key 的 provider（自建网关常无鉴权）照样声明路由，只是不带 credentialRef；
      // 否则 initialize 报的是 no adapter registered，用户看不出差在哪。
      if (keyed.has(providerId)) profile.apiKeyEnv = envName
      if (pinned && pinned.route === route) profile.models = [pinned.entry]
      profiles[route] = profile
    }
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

/** settings.models 切片；读不到按「没有路由级覆盖」处理 */
function modelsSlice(): DshModelsSettingsSlice | undefined {
  try {
    return credentialSource?.modelsSettings?.()
  } catch (err) {
    console.warn('[dsh] settings unreadable, declaring routes with apiKeyEnv only:', err)
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

/**
 * 要写进 patch 的 provider 全集：存过 key 的 ∪ 用户在模型页自定义过模型的。
 * 后者即使没 key 也要声明 —— 它的 Base URL 只有写进路由才生效。
 */
export function providersToDeclare(): string[] {
  const keys = providersWithKeys()
  let custom: string[] = []
  try {
    custom = providersWithCustomModels(modelsSlice())
  } catch (err) {
    console.warn('[dsh] customModels unreadable, declaring keyed providers only:', err)
  }
  return [...new Set([...keys, ...custom])]
}

/**
 * 该 provider 当前「凭据 + 路由配置」的指纹（不含密钥本身，不可逆）。
 * dsh 的凭据与路由都是在子进程 spawn 时经 env/patch 定死的，SDK 没有按请求换
 * key 或换 baseURL 的入口；换了之后若沿用旧进程，用户会以为新配置生效了。
 * 把它并进 dshPinnedKey，改 key / 改 Base URL / 改 retry 都会「旧进程退役、
 * 新进程带新配置」。
 */
export function dshRouteFingerprint(providerId: string): string {
  let key: string | undefined
  let profile: DshRouteProfileOverrides
  try {
    key = credentialSource?.getApiKey(providerId)
    profile = dshRouteProfileOverrides(modelsSlice(), providerId)
  } catch (err) {
    console.warn(`[dsh] route fingerprint failed for "${providerId}":`, err)
    return ''
  }
  // 既没 key 也没任何路由级覆盖 → 空指纹：没有会因为配置变化而失效的东西
  if (!key && Object.keys(profile).length === 0) return ''
  return createHash('sha256')
    .update(`${key ?? ''}\u0000${JSON.stringify(profile)}`)
    .digest('hex')
    .slice(0, 12)
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
