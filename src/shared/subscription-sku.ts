/** 目录标价为 0、但只对订阅套餐开放的型号。普通套餐调用会 429。 */
export function isSubscriptionSku(model: { id?: string; name?: string }): boolean {
  return /high[\s_-]*speed/i.test(`${model.id ?? ''} ${model.name ?? ''}`)
}

/** 厂商 id 里带 token-plan：模型标价 0 是因为包含在付费套餐里，不是公开免费。 */
export function isIncludedPlanProvider(providerId: string): boolean {
  return providerId.includes('token-plan')
}
