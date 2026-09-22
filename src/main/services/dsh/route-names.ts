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
 */
export function applyDshRoute(
  provider: string,
  modelId: string,
  routes?: Record<string, string>,
): DshRoute {
  const mapped = routes?.[provider]?.trim() || DSH_BUILTIN_ROUTE_ALIASES[provider]
  return { providerId: mapped ? mapped : provider, modelId }
}
