// =============================================================
// onboarding-done — 首用向导完成标记(壳/本体共用,独立成模块避免环)
// =============================================================

export const ONBOARDING_DONE_KEY = 'ea.onboarding.done'

/** 写入完成标记(跳过或完成均调用) */
export function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}
