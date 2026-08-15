// =============================================================
// IPC API 类型 — 学生扩展档案域 (window.api.profile)
// =============================================================

import type { StudentProfileData } from '@shared/types'

export interface ProfileAPI {
  get: (name: string) => Promise<{ success: boolean; data: StudentProfileData }>
  set: (
    name: string,
    data: Partial<StudentProfileData>,
  ) => Promise<{ success: boolean; error?: string }>
}
