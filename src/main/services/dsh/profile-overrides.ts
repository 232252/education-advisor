// =============================================================
// dsh 路由级配置映射：把 app 的 settings 里那些「pi 路径本来就在用、但子进程
// 看不见」的项，翻译成 llm-pi-ai 认的 provider profile 字段。
//
// 为什么需要它：dsh 子进程只读 patch 文件 + 环境变量，而 patch 过去只写
// { apiKeyEnv } 一个字段（provider-patch.ts）。于是自定义 Base URL 在 dsh 后端
// 被整个丢掉 —— 用户在模型页把 openai/deepseek 指到自己的网关/镜像，界面照旧、
// 请求却打到厂商官方端点(拿他的 key 去官方计费/401)。这属于静默错行为，必须修。
//
// llm-pi-ai 的 profile 字段(dsh-llm-pi-ai/lib/index.js:1027-1058)：
//   apiKeyEnv / baseURL / api / models / modelOverrides / headers / timeoutMs /
//   retryPolicy / cacheRetention / transport / reasoning / thinkingBudgets ...
// 注意 baseURL 是**路由级**的，modelFields 里没有 per-model baseUrl
// （index.js:1012-1019），所以同一 provider 下多个不同 Base URL 表达不了 ——
// 那种情况不猜，退化成「不写 baseURL」并打一条 warn。
//
// 本模块纯函数、不依赖 electron：dsh/* 的单测跑在无 electron 的 node 项目里。
// =============================================================

/** settings.models 里本模块实际读的那几项（结构类型，避免把 settings 类型拖进 dsh 模块图） */
export interface DshModelsSettingsSlice {
  retry?: {
    enabled?: boolean
    maxRetries?: number
    baseDelayMs?: number
    providerTimeoutMs?: number
  }
  cacheRetention?: string
  customModels?: Record<string, { baseUrl?: string }[]>
}

/** 一条 dsh 路由可以携带的、来自 app 配置的覆盖项（不含任何密钥值） */
export interface DshRouteProfileOverrides {
  baseURL?: string
  timeoutMs?: number
  cacheRetention?: 'none' | 'short' | 'long'
  retryPolicy?: {
    mode: 'normal'
    maxRetries: number
    backoff: { initialDelayMs: number }
  }
}

const CACHE_RETENTIONS = new Set(['none', 'short', 'long'])

/** 正有限数值守卫：settings 被手改成错误类型时按「没配」处理，而不是把子进程配置搞坏 */
function positiveNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

function wholeNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Number.isInteger(v)
    ? v
    : undefined
}

/**
 * 该 provider 的自定义模型声明的 Base URL。
 * 只有一个不重复的值才用它 —— dsh 的 baseURL 是路由级的，多值表达不了。
 */
export function dshRouteBaseURL(
  models: DshModelsSettingsSlice | undefined | null,
  providerId: string,
): string | undefined {
  const entries = models?.customModels?.[providerId] ?? []
  const distinct = [
    ...new Set(entries.map((m) => m.baseUrl?.trim()).filter((v): v is string => !!v)),
  ]
  if (distinct.length === 0) return undefined
  if (distinct.length > 1) {
    console.warn(
      `[dsh] provider "${providerId}" has ${distinct.length} different custom Base URLs; ` +
        'a dsh route carries one baseURL, so none is forwarded — the route keeps the catalog endpoint',
    )
    return undefined
  }
  return distinct[0]
}

/** 用户自定义过模型（可能带自建端点）的 provider，即使没存 key 也要声明成路由 */
export function providersWithCustomModels(
  models: DshModelsSettingsSlice | undefined | null,
): string[] {
  const dict = models?.customModels
  if (!dict) return []
  return Object.entries(dict)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([id]) => id)
}

/**
 * 该 provider 的路由级覆盖项。retry.* 与 cacheRetention 是全 provider 共用的设置，
 * 但 dsh 侧按路由声明，所以对每条路由写同样的值。
 */
export function dshRouteProfileOverrides(
  models: DshModelsSettingsSlice | undefined | null,
  providerId: string,
): DshRouteProfileOverrides {
  // 读不到 settings（未注入 / 启动早期）时一段都不写：patch 回到只带 apiKeyEnv 的
  // 旧形态，比拿代码里的默认值去覆盖 dsh 自己的默认值安全。
  if (!models) return {}
  const out: DshRouteProfileOverrides = {}
  const baseURL = dshRouteBaseURL(models, providerId)
  if (baseURL) out.baseURL = baseURL

  const timeoutMs = positiveNumber(models?.retry?.providerTimeoutMs)
  if (timeoutMs) out.timeoutMs = timeoutMs

  const retention = models?.cacheRetention
  if (retention && CACHE_RETENTIONS.has(retention)) {
    out.cacheRetention = retention as 'none' | 'short' | 'long'
  }

  const retry = models?.retry
  const enabled = typeof retry?.enabled === 'boolean' ? retry.enabled : true
  const maxRetries = enabled ? (wholeNumber(retry?.maxRetries) ?? 3) : 0
  const initialDelayMs = positiveNumber(retry?.baseDelayMs) ?? 1000
  out.retryPolicy = { mode: 'normal', maxRetries, backoff: { initialDelayMs } }
  return out
}

/**
 * dsh 侧一条路由的模型条目。
 *
 * 必须有它的理由是真子进程测出来的（2026-09-22）：llm-pi-ai 的路由**不会**沿用
 * pi 现成目录 —— 只写 { apiKeyEnv } 或再加 { baseURL } 的路由，initialize 握手
 * 成功，但一发请求就是 `pi-ai provider "x" has no configured model "y"`；
 * 补上 models: [{ id }] 之后同一发请求就打通了（打到声明的 baseURL 上）。
 * 老注释里「只带 apiKeyEnv 的路由沿用 installed catalog」在这个版本不成立。
 */
export interface DshRouteModelSource {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  thinkingLevelMap?: Record<string, string | null | undefined>
  /**
   * 该模型走的线协议（pi 的 api，如 openai-completions）。dsh 侧它是**路由级**字段
   * 而不是模型级：installed catalog 不认这条路由时（自建/本地端点）不给 api 就会被拒
   * —— 实测 `needs an api; the installed catalog does not describe it`。
   */
  api?: string
}

/** dsh 的 THINKING_LEVELS 认的档位名；目录里出现别的键就不发（发错值是整轮失败） */
const DSH_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

export interface DshRouteModelEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  reasoningEfforts?: Record<string, string | null>
}

/** 把 app 目录里的一个模型映射成 patch 条目；undefined / 空 id 都不产出条目 */
export function dshRouteModelEntry(
  src: DshRouteModelSource | undefined,
): DshRouteModelEntry | undefined {
  if (!src?.id) return undefined
  const entry: DshRouteModelEntry = { id: src.id }
  if (src.name) entry.name = src.name
  const contextWindow = positiveNumber(src.contextWindow)
  if (contextWindow) entry.contextWindow = contextWindow
  const maxTokens = positiveNumber(src.maxTokens)
  if (maxTokens) entry.maxTokens = maxTokens
  const input = src.input?.filter((m): m is 'text' | 'image' => m === 'text' || m === 'image')
  if (input && input.length > 0) entry.input = [...new Set(input)]
  const efforts: Record<string, string | null> = {}
  for (const level of DSH_THINKING_LEVELS) {
    const v = src.thinkingLevelMap?.[level]
    // 实测：dsh 只允许 'off' 这一档留空（null），其它档给 null 会被整条路由拒掉
    // —— `reasoningEfforts.medium needs the wire value dispatch should send`。
    // pi 目录里的 null 意思是「该模型不走这档」，在 dsh 侧的正确写法就是不写这一档。
    if (typeof v === 'string' && v) efforts[level] = v
    else if (v === null && level === 'off') efforts[level] = null
  }
  if (Object.keys(efforts).length > 0) entry.reasoningEfforts = efforts
  return entry
}
