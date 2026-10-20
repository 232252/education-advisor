// =============================================================
// 学业模块共享常量与纯函数 — 考试类型标签/日期排序
// (由 pages/Academics/academics-shared.ts 上移至共享层,逻辑零修改)
// =============================================================

import type { ExamType } from '@shared/types'

/** 考试类型 → 中文标签 (快速查找) */
export const EXAM_TYPE_LABEL: Record<ExamType, string> = {
  monthly: '月考',
  midterm: '期中',
  final: '期末',
  quiz: '随堂测验',
  test: '平时测试',
  mock: '模拟考试',
  other: '其他',
}

/** 考试类型 → Badge 颜色 */
export const EXAM_TYPE_BADGE: Record<
  ExamType,
  'info' | 'success' | 'warning' | 'danger' | 'neutral'
> = {
  monthly: 'info',
  midterm: 'warning',
  final: 'danger',
  quiz: 'neutral',
  test: 'neutral',
  mock: 'success',
  other: 'neutral',
}

/** 按考试日期降序排序 (最新在前) */
export function sortByDateDesc<T extends { date?: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}
