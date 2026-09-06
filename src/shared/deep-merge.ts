// =============================================================
// 深度合并(设置域共用) — 主进程加载与渲染层 partial 合并的单一来源
//
// 规则:
//   - 两边都是 plain object(非 null/非数组) → 递归合并,确保默认叶子字段保留
//   - 数组/原始值/null → source 直接覆盖
//   - source 中值为 undefined 的 key → 跳过,保留 target 原值
//     (JSON.parse 产物不含 undefined,对 settings.json 加载是 no-op;
//      渲染层 partial 合并依赖此语义 — UI-1 修复)
// =============================================================

export function deepMergeSettings(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    if (sourceVal === undefined) continue
    const targetVal = target[key]
    const sourceIsPlainObj =
      sourceVal !== null && typeof sourceVal === 'object' && !Array.isArray(sourceVal)
    const targetIsPlainObj =
      targetVal !== null && typeof targetVal === 'object' && !Array.isArray(targetVal)
    if (sourceIsPlainObj && targetIsPlainObj) {
      result[key] = deepMergeSettings(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }
  return result
}
