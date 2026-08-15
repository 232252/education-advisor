// =============================================================
// 按 Agent 聚合 MCP 工具
//
// 获取指定 Agent 可用的所有 MCP 工具(已适配为 AgentTool)。
// 三层配置合并优先级:技能级 > Agent 级 > 全局
// 详见 mcp-service.ts 的 listToolsForAgent()
// =============================================================

import type { McpServerConfig } from '@shared/types'
import { mcpService } from '../../mcp-service'
import { type AnyAgentTool, mcpToolToAgentTool } from './adapter'

/**
 * 获取指定 Agent 可用的所有 MCP 工具(已适配为 AgentTool)
 *
 * 三层配置合并优先级:技能级 > Agent 级 > 全局
 * 详见 mcp-service.ts 的 listToolsForAgent()
 *
 * @param agentId Agent ID
 * @param agentMcpServers Agent 级启用的全局 MCP server ID 列表
 * @param skillMcpServers 技能级临时 MCP server 配置(激活时加载,结束时清理)
 * @returns AgentTool<any>[] 可能为空数组(MCP 未启用或无配置时)
 */
export async function getMcpToolsForAgent(
  agentId: string,
  agentMcpServers?: string[],
  skillMcpServers?: McpServerConfig[],
): Promise<AnyAgentTool[]> {
  try {
    const mcpTools = await mcpService.listToolsForAgent(agentId, agentMcpServers, skillMcpServers)
    if (mcpTools.length === 0) return []

    // 适配为 AgentTool,按 serverId+toolName 去重(技能级覆盖全局同名)
    const seen = new Set<string>()
    const agentTools: AnyAgentTool[] = []
    for (const mcpTool of mcpTools) {
      const key = `${mcpTool.serverId}::${mcpTool.name}`
      if (seen.has(key)) continue
      seen.add(key)
      agentTools.push(mcpToolToAgentTool(mcpTool.serverId, mcpTool))
    }
    return agentTools
  } catch (err) {
    console.warn(`[mcp-tools] Failed to load MCP tools for agent ${agentId}:`, err)
    return []
  }
}
