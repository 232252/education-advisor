// =============================================================
// 学业时间口径 — 学期标识与今日日期(主进程/渲染端共用)
// 学期: 9 月–次年 2 月为第 1 学期, 3–8 月为第 2 学期。
// 日期一律本地时区: UTC 口径在东八区凌晨会把"今天"算成昨天。
// =============================================================

/** 当前学期标识,如 "2025-2026-1" */
export function currentSemester(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const semester = month >= 9 || month <= 2 ? 1 : 2
  const startYear = month >= 9 ? year : year - 1
  return `${startYear}-${startYear + 1}-${semester}`
}

/** 本地时区今日 YYYY-MM-DD */
export function todayIsoDate(now: Date = new Date()): string {
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
