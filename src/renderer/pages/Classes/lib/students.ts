// =============================================================
// 班级学生纯计算 — 风险排序 / 名单过滤 / 日期格式化
// =============================================================

import type { EAARiskLevel, EAAStudent } from '@shared/types'

/** 风险等级排序权重（极高 → 低） */
export const RISK_ORDER: Record<EAARiskLevel, number> = { 极高: 0, 高: 1, 中: 2, 低: 3 }

/** 本班学生（按 class_id 过滤 + 按风险等级排序） */
export function filterClassStudents(allStudents: EAAStudent[], classId: string): EAAStudent[] {
  return allStudents
    .filter((s) => s.class_id === classId)
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
}

/** 可分入的学生：未分班 + 其他班（不含本班），按姓名排序 */
export function filterAssignableStudents(allStudents: EAAStudent[], classId: string): EAAStudent[] {
  return allStudents
    .filter((s) => s.class_id !== classId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 创建日期格式化为 YYYY-MM-DD */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
