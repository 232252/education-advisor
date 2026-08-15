// =============================================================
// 技能类型
// =============================================================

import type { McpServerConfig } from './mcp'

export interface Skill {
  name: string
  description: string
  content: string
  source: 'user' | 'project'
  filePath: string
  /** MCP 集成:技能级临时 MCP server 配置(激活时加载,结束时清理) */
  mcpServers?: McpServerConfig[]
}
