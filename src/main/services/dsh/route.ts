// =============================================================
// pi 的 provider/model → dsh 子进程的模型路由名（读设置的那一半）
//
// 为什么必须映射而不是直接透传：dsh 的 provider 路由不是内置枚举，而是用户在自己
// 的 dsh settings 里声明的 providers 字典的键
// （dsh-llm-pi-ai/src/config.ts:90「the providers dict key IS the route」），
// 且未声明任何 profile 时该适配器一条路由都不注册
// （llm-pi-ai/src/index.ts:161）—— 实测 initialize({provider:'deepseek'}) 直接报
// no adapter registered for provider。app 侧现在会替「存过 key 的那些 provider」
// 自动声明同名路由（见 provider-patch.ts），这里只保留用户手动改名的口子。
//
// 改名规则本身在 route-names.ts（不依赖 electron，供 dsh/runtime 共用）。
// =============================================================

import { settingsService } from '../settings-service'
import { dshRouteBaseURL } from './profile-overrides'
import { applyDshRoute, type DshRoute } from './route-names'

export type { DshRoute } from './route-names'
export { DSH_BUILTIN_ROUTE_ALIASES } from './route-names'

export function dshRouteFor(provider: string, modelId: string): DshRoute {
  let routes: Record<string, string> | undefined
  let customEndpoint = false
  try {
    const models = settingsService.getSettings().models
    routes = models?.dshRoutes
    // 填了自建 Base URL 的 provider 不能被内建别名拐走（见 applyDshRoute）
    customEndpoint = dshRouteBaseURL(models, provider) !== undefined
  } catch (err) {
    // 读不到设置时按同名直通，不能因一次读失败打断这次调用
    console.warn('[dsh] settings unreadable, using pi provider id as route:', err)
  }
  return applyDshRoute(provider, modelId, routes, { customEndpoint })
}
