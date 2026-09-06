// =============================================================
// 技能 API 类型(单一来源: preload 实现按此注解)
// =============================================================

import type { Skill } from '@shared/types'

export interface SkillAPI {
  // [r] 列出技能
  list: () => Promise<Skill[]>
  // [r] 读取技能(不存在返回 null)
  get: (name: string) => Promise<Skill | null>
  // [w] 写入技能
  save: (name: string, content: string) => Promise<{ success: boolean; error?: string }>
  // [c] 删除技能 — UI 层应二次确认
  delete: (name: string) => Promise<{ success: boolean; error?: string }>
}
