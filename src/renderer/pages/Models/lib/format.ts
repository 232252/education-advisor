// =============================================================
// Models 页格式化助手 — 模型成本/上下文窗口展示
// =============================================================

import { tr } from '../../../i18n'

/** 格式化每 token 成本为每百万 token 价格 */
export function formatCost(costPerToken: number): string {
  if (costPerToken === 0) return tr('models.cost.free', {})
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`
  return `$${perMillion.toFixed(2)}/M`
}
