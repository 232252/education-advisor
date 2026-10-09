// =============================================================
// Models 页格式化助手 — 模型成本/上下文窗口展示
// =============================================================

import { isSubscriptionSku } from '@shared/subscription-sku'
import { t, tr } from '../../../i18n'

/** 格式化每 token 成本为每百万 token 价格。目录价在进 ModelInfo 之前已从「美元/百万」换成每 token。 */
export function formatCost(costPerToken: number, model?: { id?: string; name?: string }): string {
  if (costPerToken === 0 && model && isSubscriptionSku(model)) {
    return t('models.cost.subscription', '按套餐')
  }
  if (costPerToken === 0) return tr('models.cost.free', {})
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`
  return `$${perMillion.toFixed(2)}/M`
}

/** 编辑框用美元/百万 token，和表格里的 $0.30/M 同一单位。 */
export function usdPerMillionInput(costPerToken: number): string {
  if (!Number.isFinite(costPerToken) || costPerToken === 0) return '0'
  const perMillion = Math.round(costPerToken * 1_000_000 * 1_000_000) / 1_000_000
  return String(perMillion)
}

export function perTokenFromUsdPerMillionInput(text: string): number {
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n / 1_000_000
}

export function modelCostEditFields(model: {
  costPerInputToken: number
  costPerOutputToken: number
}): { costPerInputToken: string; costPerOutputToken: string } {
  return {
    costPerInputToken: usdPerMillionInput(model.costPerInputToken),
    costPerOutputToken: usdPerMillionInput(model.costPerOutputToken),
  }
}

export function modelCostUpdatesFromEdit(
  model: { costPerInputToken: number; costPerOutputToken: number },
  form: { costPerInputToken?: string; costPerOutputToken?: string },
): { costPerInputToken?: number; costPerOutputToken?: number } {
  const updates: { costPerInputToken?: number; costPerOutputToken?: number } = {}
  const nextIn = perTokenFromUsdPerMillionInput(form.costPerInputToken ?? '')
  const nextOut = perTokenFromUsdPerMillionInput(form.costPerOutputToken ?? '')
  if (Math.abs(nextIn - model.costPerInputToken) > 1e-12) updates.costPerInputToken = nextIn
  if (Math.abs(nextOut - model.costPerOutputToken) > 1e-12) updates.costPerOutputToken = nextOut
  return updates
}
