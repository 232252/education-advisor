// =============================================================
// 纯的 provider 路由改名（不读设置，因此不依赖 electron）
//
// 拆出去的原因：route.ts 要读 settingsService，而 settings-service 静态 import
// electron + 日志链路（utils/log/state.ts 在模块顶层就 app.getPath），所以只要
// runtime.ts 把 route.ts 拉进依赖图，dsh/* 那批跑在 node 项目里的单测就会整批
// 挂在模块解析阶段。createDshRuntime 需要同一套改名规则，但它可以由 bootstrap
// 把映射表注入进来 —— 于是共享的是规则，不是设置读取。
// =============================================================

export interface DshRoute {
  /** 交给 initialize 的 provider（dsh 侧路由 key） */
  providerId: string
  /** 交给 initialize 的 model id */
  modelId: string
}

/**
 * 有据可查的内建别名：dsh-base 的 `llm-deepseek` 行注册的路由名就是
 * `deepseek-official`（packages/llm/llm-deepseek/src/index.ts:57）。实测 pi 侧的
 * 'deepseek' 直通会报 no adapter registered，换成这个名字则进到凭据校验。
 */
export const DSH_BUILTIN_ROUTE_ALIASES: Readonly<Record<string, string>> = {
  deepseek: 'deepseek-official',
}

/**
 * routes 是 settings.models.dshRoutes 的内容（pi provider id → dsh 路由 key）。
 * 用户显式改名优先，其次内建别名，最后同名直通 —— 不猜可用性。
 *
 * opts.customEndpoint = 该 provider 在 app 里声明了自建 Base URL。此时跳过内建别名：
 * 内建那一行的 baseURL 是 dsh 自己写死的，app 的 patch 只能覆盖 llm-pi-ai 声明的
 * 路由。用户在模型页填了网关/镜像还继续走别名，就是「界面显示网关、请求打到官方
 * 端点」的静默错行为。
 */
export function applyDshRoute(
  provider: string,
  modelId: string,
  routes?: Record<string, string>,
  opts?: { customEndpoint?: boolean },
): DshRoute {
  const aliased = DSH_BUILTIN_ROUTE_ALIASES[provider] && !opts?.customEndpoint
  const mapped =
    routes?.[provider]?.trim() || (aliased ? DSH_BUILTIN_ROUTE_ALIASES[provider] : undefined)
  return { providerId: mapped ? mapped : provider, modelId }
}

/**
 * app 的推理档位 → dsh `initialize` 认的 reasoningEffort。
 *
 * dsh 会拿**该模型在 pi-ai 目录里的档位表**校验它（实测：deepseek-flash 只接受
 * low/high，传 medium/minimal/none/乱码都让整轮以
 * `does not support reasoning effort "x"` 失败；high/low 则确实落到 provider 请求的
 * reasoning_effort 字段上）。宿主看不到 dsh 的档位枚举，但目录就在 app 里 ——
 * 模型自带的 thinkingLevelMap 即权威来源。
 *
 * 所以：档位缺失、'off'、或该模型不给这一档 ⇒ 返回 undefined（省略该字段，退回
 * 模型默认档）。少一档比整轮打挂好；模型目录整个缺失（自定义模型）时按名字透传，
 * 因为没有任何依据可以否定它。
 */
export function dshReasoningEffort(
  thinkingLevelMap: Partial<Record<string, string | null>> | undefined,
  thinking: string | undefined,
): string | undefined {
  if (!thinking || thinking === 'off') return undefined
  if (thinkingLevelMap === undefined) return thinking
  const mapped = thinkingLevelMap[thinking]
  // 目录里显式给 null = 这一档该模型不走
  if (mapped === null) return undefined
  return mapped ?? undefined
}
