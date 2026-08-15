// =============================================================
// IPC API 类型 — Agent 域 (window.api.agent)
// =============================================================

import type { AgentDetail, AgentListItem } from '@shared/types'

export interface AgentAPI {
  list: () => Promise<AgentListItem[]>
  get: (id: string) => Promise<AgentDetail | null>
  toggle: (id: string, enabled: boolean) => Promise<{ success: boolean }>
  update: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      modelTier: 'high_quality' | 'low_cost'
      capabilities: string[]
      mcpServers: string[]
    }>,
  ) => Promise<{ success: boolean; error?: string }>
  setSoul: (id: string, content: string) => Promise<{ success: boolean }>
  setRules: (id: string, content: string) => Promise<{ success: boolean }>
  runManual: (
    id: string,
    prompt: string,
    history?: Array<{ role: string; content: string }>,
  ) => Promise<{ success: boolean; message?: string; id?: string }>
  getHistory: (id: string) => Promise<unknown[]>
  abort: (id: string) => Promise<{ success: boolean }>
  onStatusUpdate: (callback: (data: unknown) => void) => () => void
}
