// =============================================================
// IPC API 类型 — 班级管理域 (window.api.class)
// =============================================================

import type { ClassAssignParams, ClassEntity, ClassUpsertParams } from '@shared/types'

export interface ClassAPI {
  list: () => Promise<{ success: boolean; data: ClassEntity[]; error?: string }>
  create: (
    params: ClassUpsertParams,
  ) => Promise<{ success: boolean; data?: ClassEntity; error?: string }>
  update: (
    id: string,
    fields: {
      name?: string
      grade?: string | null
      note?: string | null
      teacher?: string | null
    },
  ) => Promise<{ success: boolean; error?: string }>
  archive: (id: string) => Promise<{ success: boolean; error?: string }>
  restore: (id: string) => Promise<{ success: boolean; error?: string }>
  delete: (id: string) => Promise<{ success: boolean; classId?: string; error?: string }>
  assign: (
    params: ClassAssignParams,
  ) => Promise<{ success: boolean; assigned?: number; failed?: string[]; error?: string }>
  /** 调班进度事件订阅，返回取消订阅函数。data: { current, total, assigned, lastName } */
  onAssignProgress: (
    callback: (data: {
      current: number
      total: number
      assigned: number
      lastName: string
    }) => void,
  ) => () => void
}
