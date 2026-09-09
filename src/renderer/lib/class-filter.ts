// =============================================================
// 班级筛选 — 哨兵常量 + 命中谓词(唯一事实来源)
// 此前常量定义 2 份(student-filters/dashboard-stats)、谓词分支 4 份、
// 魔法字符串散落渲染层 17 处;改语义(如「仅活跃班级」)从此单点生效。
// 注意: __ALL__ 也被学期筛选复用,但那是独立域,勿混用本模块。
// =============================================================

/** 班级筛选特殊值: 全部班级 / 未分班 */
export const CLASS_FILTER_ALL = '__ALL__'
export const CLASS_FILTER_NONE = '__NONE__'

/**
 * 判断实体的所属班级是否命中当前班级筛选。
 * entityClassId 为 null/undefined = 未分班;classFilter 为具体 class_id 时精确匹配。
 */
export function matchesClassFilter(
  entityClassId: string | null | undefined,
  classFilter: string,
): boolean {
  if (classFilter === CLASS_FILTER_ALL) return true
  if (classFilter === CLASS_FILTER_NONE) return !entityClassId
  return entityClassId === classFilter
}
