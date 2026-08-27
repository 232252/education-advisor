// =============================================================
// EAA 日期入参校验(R2-21 收敛: params.ts 与 handlers-system.ts
// 各自维护同构 dateRe + 同文案的重复实现)
// =============================================================

/** ISO 日期格式 YYYY-MM-DD(仅格式校验;语义校验由 Rust 端最终把关) */
export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}
