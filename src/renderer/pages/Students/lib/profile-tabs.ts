// =============================================================
// 学生档案 Tab id — URL 定位与 StudentProfile 共用
// =============================================================

export type StudentProfileTabId =
  | 'overview'
  | 'profile'
  | 'events'
  | 'academics'
  | 'ai'
  | 'home_school'

export const STUDENT_PROFILE_TAB_IDS: readonly StudentProfileTabId[] = [
  'overview',
  'profile',
  'events',
  'academics',
  'ai',
  'home_school',
]

export function parseStudentProfileTab(raw: string | null | undefined): StudentProfileTabId | null {
  if (!raw) return null
  return (STUDENT_PROFILE_TAB_IDS as readonly string[]).includes(raw)
    ? (raw as StudentProfileTabId)
    : null
}
