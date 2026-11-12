// =============================================================
// 双评前置校验 — 与 gradePaperByStrategy / resolveGradingExecution 同一句错误
// 未配置第二模型时直接失败，不得把策略降成 standard。
// =============================================================

import { settingsService } from '../settings-service'

export const DUAL_MODEL_MISSING = '双评模式未配置第二模型(设置→模型→批改模型)'

/** strategy 不是 dual 时直接返回。dual 且没有第二模型则抛 DUAL_MODEL_MISSING。 */
export function assertDualModelConfigured(strategy: string | undefined): void {
  if (strategy !== 'dual') return
  const grading = settingsService.getSettings().grading
  if (!grading?.provider2 || !grading?.model2) {
    throw new Error(DUAL_MODEL_MISSING)
  }
}
