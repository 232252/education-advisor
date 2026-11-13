// =============================================================
// DSH 运行时版本的单一来源
//
// 核心运行时规划（docs/DSH_CORE_RUNTIME.md §4.1）：官方版本只在一处锁定，
// 小升级 = 改 pin + 跑 CI。教师端任何面向用户的 DSH 版本文案都从这里取，
// 不再把版本串写死在提示里（升级时漏改就会误导教师）。
//
// 兜底值与 package.json 的 dsh-* pin 同步；装配时宿主可用实际解压出的
// 运行时清单覆盖（configureDshRuntimeVersion）。本模块不依赖 electron。
// =============================================================

/** 与 package.json 中 @deepseek-ai/dsh-sdk-client 等 dsh-* pin 保持一致。 */
const FALLBACK_VERSION = '0.2.2-rc.1'

let configured = ''

/** 装配注入实际运行时版本；传空串恢复为兜底 pin。 */
export function configureDshRuntimeVersion(version: string): void {
  configured = version.trim()
}

/** 当前教师端文案应使用的 DSH 版本。 */
export function dshRuntimeVersion(): string {
  return configured || FALLBACK_VERSION
}
