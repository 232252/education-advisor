// =============================================================
// 学业页 Tab id — URL 定位与 AcademicsPage 共用
// =============================================================

export type AcademicsTab = 'overview' | 'exams' | 'entry' | 'compare'

export const ACADEMICS_TAB_IDS: readonly AcademicsTab[] = ['overview', 'exams', 'entry', 'compare']

export function parseAcademicsTab(raw: string | null | undefined): AcademicsTab | null {
  if (!raw) return null
  return (ACADEMICS_TAB_IDS as readonly string[]).includes(raw) ? (raw as AcademicsTab) : null
}
