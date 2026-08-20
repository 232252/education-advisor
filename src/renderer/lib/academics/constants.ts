// =============================================================
// 学业共享常量 — 科目映射与图表色板(唯一事实来源)
// 由 pages/Academics 与 pages/Students 两处重复定义合并而来
// =============================================================

/** 科目 ID → 中文名 */
export const ACADEMIC_SUBJECT_MAP: Record<string, string> = {
  chinese: '语文',
  math: '数学',
  english: '英语',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  politics: '政治',
  history: '历史',
  geography: '地理',
  pe: '体育',
}

/** 图表配色 — 每个科目一种颜色 (趋势线图/科目柱状图/偏科分析共用) */
export const SUBJECT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#06b6d4',
  '#ec4899',
  '#eab308',
  '#14b8a6',
  '#6366f1',
]
