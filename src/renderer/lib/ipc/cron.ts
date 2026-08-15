// =============================================================
// IPC API 类型 — 定时任务域 (window.api.cron)
// =============================================================

import type { CronLogEntry, CronTask } from '@shared/types'

export interface CronAPI {
  list: () => Promise<CronTask[]>
  add: (task: unknown) => Promise<string>
  update: (id: string, patch: unknown) => Promise<{ success: boolean }>
  remove: (id: string) => Promise<{ success: boolean }>
  toggle: (id: string, enabled: boolean) => Promise<{ success: boolean }>
  runNow: (id: string) => Promise<{ success: boolean }>
  getLogs: (taskId?: string) => Promise<CronLogEntry[]>
  onStatusUpdate: (callback: (data: unknown) => void) => () => void
}
