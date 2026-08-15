// =============================================================
// IPC API 类型 — 隐私引擎域 (window.api.privacy)
// =============================================================

import type { EAAResult, PrivacyMapping } from '@shared/types'

export interface PrivacyAPI {
  init: (password: string, autoScan?: boolean) => Promise<EAAResult>
  load: (password: string) => Promise<EAAResult>
  list: (password?: string) => Promise<EAAResult<PrivacyMapping[]>>
  add: (entityType: string, text: string) => Promise<EAAResult>
  dryrun: (text: string) => Promise<EAAResult>
  backup: (destPath: string) => Promise<EAAResult>
  lock: () => Promise<{ success: boolean }>
  status: () => Promise<{ unlocked: boolean }>
}
