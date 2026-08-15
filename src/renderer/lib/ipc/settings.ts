// =============================================================
// IPC API 类型 — 设置域 (window.api.settings)
// =============================================================

import type { UnifiedSettings } from '@shared/types'

export interface SettingsAPI {
  get: () => Promise<UnifiedSettings>
  set: (path: string, value: unknown) => Promise<{ success: boolean }>
  reset: () => Promise<{ success: boolean }>
}
