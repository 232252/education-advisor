// =============================================================
// MCP 工具发现与调用 — Agent 视角的工具列表/调用/测试
//
// 职责:
//   - listToolsForAgent: 合并三层配置(全局 + Agent 级 + 技能级)后收集工具
//   - callTool: 调用 MCP 工具(含惰性重连)
//   - listTools: 列出指定 server 的工具
//   - testServer: 测试 server 连通性
// =============================================================

import type { McpServerConfig, McpTool } from '@shared/types'
import type { McpCallResult } from '../mcp/types'
import { settingsService } from '../settings-service'
import type { McpServiceContext } from './context'
import { init } from './lifecycle'

/**
 * 获取 Agent 可用的所有 MCP 工具
 * 合并三层配置:全局 mcp.yaml + Agent 级 mcpServers + 技能级临时 server
 */
export async function listToolsForAgent(
  ctx: McpServiceContext,
  agentId: string,
  agentMcpServers?: string[],
  skillMcpServers?: McpServerConfig[],
): Promise<McpTool[]> {
  if (!ctx.initialized) await init(ctx)

  // Feature flag 关闭时返回空
  const settings = settingsService.getSettings()
  if (settings?.mcp?.enabled !== true) return []

  // 合并 server 列表:Agent 级引用全局 + 技能级临时
  const serversToConnect: McpServerConfig[] = []

  // 1. Agent 级启用的全局 server
  if (agentMcpServers && agentMcpServers.length > 0) {
    for (const serverId of agentMcpServers) {
      const globalServer = ctx.configStore.configList.find((s) => s.id === serverId)
      if (globalServer) {
        serversToConnect.push(globalServer)
      } else {
        // R8-5 修复: 引用不存在的 server 时记录警告(之前静默跳过,用户 typo 无信号)
        console.warn(
          `[McpService] Agent ${agentId} referenced missing MCP server "${serverId}", skipped`,
        )
      }
    }
  }

  // 2. 技能级临时 server(优先级高,覆盖同名全局 server)
  // ⚠️ 当前未接线(NOT WIRED): 此分支目前是死代码。
  //   - skill-service.ts 不解析 SKILL.md frontmatter 的 mcp_servers 字段
  //   - agent-service.ts:344 调 getMcpToolsForAgent 时只传 2 个参数,第三参恒为 undefined
  //   设计文档(specs/2026-07-17-skills-mcp-hub-design.md §7)明确本次不做技能级 MCP。
  //   保留此分支是为了未来接线时三层合并逻辑已就绪。若要启用,需:
  //   1) skill-service.ts 解析 frontmatter mcp_servers → Skill.mcpServers
  //   2) agent-service.ts 把激活技能的 mcpServers 传给 getMcpToolsForAgent 第三参
  if (skillMcpServers && skillMcpServers.length > 0) {
    for (const skillServer of skillMcpServers) {
      // 移除同名的全局 server
      const idx = serversToConnect.findIndex((s) => s.id === skillServer.id)
      if (idx >= 0) serversToConnect.splice(idx, 1)
      serversToConnect.push(skillServer)
    }
  }

  // 惰性连接 + 收集工具
  const allTools: McpTool[] = []
  for (const server of serversToConnect) {
    try {
      const client = await ctx.clientPool.ensureConnected(server)
      allTools.push(...client.tools)
    } catch (err) {
      console.warn(`[McpService] Failed to connect server ${server.id} for agent ${agentId}:`, err)
      // 不阻塞其他 server,继续收集
    }
  }
  return allTools
}

/**
 * 调用 MCP 工具。
 *
 * R2-2 修复: 若 client 存在但已断开(child exit / ws close),尝试惰性重连一次,
 * 而非直接抛 "not connected" 让调用方永久失败直到重启。
 * 重连失败才抛错。这覆盖了 stdio 子进程崩溃后 Agent 下次调用自动恢复的场景。
 */
export async function callTool(
  ctx: McpServiceContext,
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  let client = ctx.clientPool.clientsMap.get(serverId)
  if (!client?.connected) {
    // 惰性重连: 找到配置则重连,无配置才抛错
    const serverConfig = ctx.configStore.configList.find((s) => s.id === serverId)
    if (!serverConfig) {
      throw new Error(`MCP server ${serverId} not connected and no config to reconnect`)
    }
    try {
      client = await ctx.clientPool.ensureConnected(serverConfig)
    } catch (err) {
      throw new Error(`MCP server ${serverId} reconnect failed: ${(err as Error).message}`)
    }
  }
  return ctx.clientPool.callToolInternal(client, toolName, args)
}

/**
 * 列出指定 server 的工具
 */
export async function listTools(ctx: McpServiceContext, serverId: string): Promise<McpTool[]> {
  const client = ctx.clientPool.clientsMap.get(serverId)
  if (!client?.connected) return []
  return client.tools
}

/**
 * 测试 server 连通性(连接 + listTools + 不调用任何工具)
 */
export async function testServer(
  ctx: McpServiceContext,
  serverId: string,
): Promise<{ success: boolean; toolCount: number; error?: string }> {
  try {
    const serverConfig = ctx.configStore.configList.find((s) => s.id === serverId)
    if (!serverConfig) {
      return { success: false, toolCount: 0, error: `Server ${serverId} not found` }
    }
    const client = await ctx.clientPool.ensureConnected(serverConfig)
    return { success: true, toolCount: client.tools.length }
  } catch (err) {
    return { success: false, toolCount: 0, error: (err as Error).message }
  }
}
