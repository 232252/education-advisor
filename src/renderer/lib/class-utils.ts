// =============================================================
// 班级工具 — renderer 层共享的班级辅助函数
// (Students / Academics 两模块原先各自维护一份相同实现,合并至此)
// =============================================================

/** class_id → 班级名称 映射 */
export function buildClassIdToNameMap(
  classList: Array<{ class_id: string; name: string }>,
): Record<string, string> {
  const m: Record<string, string> = {}
  for (const c of classList) m[c.class_id] = c.name
  return m
}
