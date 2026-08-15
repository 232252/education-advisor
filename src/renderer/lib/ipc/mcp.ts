// =============================================================
// IPC API 类型 — MCP 域 (window.api.mcp)
// =============================================================

import type { McpServerConfig, McpServerStatus, McpTool } from '@shared/types'

export interface McpAPI {
  list: () => Promise<{ success: boolean; servers: McpServerStatus[]; error?: string }>
  connect: (serverId: string) => Promise<{ success: boolean; error?: string }>
  disconnect: (serverId: string) => Promise<{ success: boolean; error?: string }>
  listTools: (serverId: string) => Promise<{ success: boolean; tools: McpTool[]; error?: string }>
  test: (serverId: string) => Promise<{ success: boolean; toolCount: number; error?: string }>
  add: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>
  update: (
    serverId: string,
    patch: Partial<McpServerConfig>,
  ) => Promise<{ success: boolean; error?: string }>
  remove: (serverId: string) => Promise<{ success: boolean; error?: string }>
}
