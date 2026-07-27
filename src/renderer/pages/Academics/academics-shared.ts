// =============================================================
// 学业模块共享常量与纯函数 — 供 AcademicsPage 及各 Tab 共用
// 仅存放被多个文件引用的常量/类型/函数,避免重复定义
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

/** 获取当前学期标识 (如 "2025-2026-1") */
export function getCurrentSemester(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  // 9-2月 → 第一学期; 3-7月 → 第二学期
  const semester = month >= 9 || month <= 2 ? 1 : 2
  const startYear = month >= 9 ? year : year - 1
  const endYear = startYear + 1
  return `${startYear}-${endYear}-${semester}`
}
