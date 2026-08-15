// =============================================================
// IPC API 类型 — 技能域 (window.api.skill)
// =============================================================

import type { Skill } from '@shared/types'

export interface SkillAPI {
  list: () => Promise<Skill[]>
  get: (name: string) => Promise<Skill | null>
  save: (name: string, content: string) => Promise<{ success: boolean }>
  delete: (name: string) => Promise<{ success: boolean; error?: string }>
}
