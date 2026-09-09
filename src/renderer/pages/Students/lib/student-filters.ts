// =============================================================
// 学生列表过滤/排序/选择工具 — 从 StudentsPage 提取的纯函数
//
// 提取原因：这些逻辑在 useMemo 闭包里，难以单测且每次渲染重建。
// 提取为纯函数后可独立测试过滤/排序/选择边界。
// =============================================================

import type { EAARiskLevel, EAAStudent } from '@shared/types'
import { matchesClassFilter } from '../../../lib/class-filter'
import { pinyinScore } from '../../../lib/pinyin-match'

/** 风险等级排序权重（极高 > 高 > 中 > 低） */
export const RISK_ORDER: Record<EAARiskLevel, number> = { 极高: 0, 高: 1, 中: 2, 低: 3 }

/**
 * 按班级/搜索词/已存档班级过滤学生列表。
 *
 * @param students 全部学生
 * @param classFilter 班级筛选值（__ALL__=全部 / __NONE__=未分班 / 具体 class_id）
 * @param search 搜索词（匹配 name/groups/roles）
 * @param archivedClassIds 已存档班级的 class_id 集合
 * @param showArchivedClass 是否显示已存档班级学生
 */
export function filterStudents(
  students: EAAStudent[],
  classFilter: string,
  search: string,
  archivedClassIds: Set<string>,
  showArchivedClass: boolean,
): EAAStudent[] {
  return students.filter((s) => {
    // 班级筛选
    if (!matchesClassFilter(s.class_id, classFilter)) return false
    // 默认隐藏已存档班级的学生
    if (!showArchivedClass && s.class_id && archivedClassIds.has(s.class_id)) return false
    // 搜索匹配 name(含拼音)/groups/roles — 纯字母查询时姓名按拼音命中
    // (输 "zs" 找张三),与命令面板同口径
    return (
      s.name.includes(search) ||
      pinyinScore(search, s.name) >= 0 ||
      s.groups.some((g) => g.includes(search)) ||
      s.roles.some((r) => r.includes(search))
    )
  })
}

/** 统计被隐藏的已存档班级学生数 */
export function countArchivedHidden(students: EAAStudent[], archivedClassIds: Set<string>): number {
  return students.filter((s) => s.class_id && archivedClassIds.has(s.class_id)).length
}

/** 按风险等级排序（高风险优先，不修改原数组） */
export function sortStudentsByRisk(students: EAAStudent[]): EAAStudent[] {
  return [...students].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
}

/** 判断当前可见列表是否全选 */
export function isAllSelected(students: EAAStudent[], selectedNames: Set<string>): boolean {
  return students.length > 0 && students.every((s) => selectedNames.has(s.name))
}
