// =============================================================
// 按 Agent 聚合 MCP 工具
//
// 获取指定 Agent 可用的所有 MCP 工具(已适配为 AgentTool)。
// 三层配置合并优先级:技能级 > Agent 级 > 全局
// 详见 mcp-service.ts 的 listToolsForAgent()
//
// 本目录(mcp-management/tools/)的安全设计(M19 随实现从 services/mcp-tools.ts 迁入):
//   - schema.ts    JSON Schema → typebox 转换
//   - sanitize.ts  参数安全校验(validateFilePath / sanitizeArg)
//   - adapter.ts   MCP tool → AgentTool 适配 + AbortSignal + 结果格式化
//   - aggregate.ts 按 Agent 聚合工具(三层配置合并,本文件)
//
// 安全设计:
//   - 路径参数(名称含 path/file/dir)强制走 validateFilePath(14 个敏感路径黑名单)
//   - 所有字符串参数走 sanitizeArg(控制字符/shell 元字符/ -- 前缀过滤)
//   - 工具名前缀 mcp_<serverId>_,与 EAA 工具(eaa_*)和内置工具(read_file 等)区分
//   - 调用结果大小限制由 mcp-service.ts 的 callTool 保证(5MB)
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
