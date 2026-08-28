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
  /** 技能讲授的工具名(frontmatter tools: 字段)。
   *  用于按 agent 实际工具集过滤注入 — 空/缺省表示对全体 agent 可见 */
  tools?: string[]
}
