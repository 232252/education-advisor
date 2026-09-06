// =============================================================
// 学生扩展档案 API 类型(单一来源: preload 实现按此注解)
// =============================================================

import type { StudentProfileData } from '@shared/types'

/** 档案读取信封 */
export interface ProfileResult {
  success: boolean
  error?: string
  data?: StudentProfileData
}

export interface ProfileAPI {
  // [r] 读取学生扩展档案
  get: (name: string) => Promise<ProfileResult>
  // [w] 写入学生扩展档案
  set: (name: string, data: unknown) => Promise<ProfileResult>
}
