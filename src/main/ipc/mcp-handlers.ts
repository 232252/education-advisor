// =============================================================
// MCP IPC 处理器
//
// 提供 5 个 IPC 接口供前端管理 MCP server:
//   - mcp:list        列出所有配置的 server 及连接状态
//   - mcp:connect     手动连接指定 server
//   - mcp:disconnect  断开指定 server
//   - mcp:list-tools  列出指定 server 的工具
//   - mcp:test        测试 server 连通性(连接 + listTools)
//
// 安全说明:
//   - 所有 serverId 参数做格式校验(只允许字母数字_-)
//   - 实际工具调用通过 AgentTool.execute 走 mcp-management/tools/sanitize.ts 的 sanitizeMcpArgs
//   - 这里只提供管理接口,不直接调用工具(工具调用由 Agent 运行时触发)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { McpServerConfig } from '@shared/types'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { mcpService } from '../services/mcp-service'
import { handleIpc } from './handle'

/** 校验 serverId 格式(防注入) */
function validateServerId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('serverId must be a non-empty string')
  }
  if (id.length > 128) {
    throw new Error('serverId too long (max 128 chars)')
  }
  // 只允许字母数字下划线连字符
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('serverId contains invalid characters (only a-zA-Z0-9_- allowed)')
  }
  return id
}

export function registerMcpHandlers(_win: BrowserWindow) {
  // 列出所有配置的 server 及连接状态
  handleIpc(
    IPC.IPC_MCP_LIST,
    async () => {
      return { success: true, servers: mcpService.listServers() }
    },
    (msg) => ({ success: false, servers: [], error: msg }),
  )

  // 手动连接指定 server
  handleIpc(
    IPC.IPC_MCP_CONNECT,
    async (_e, serverId: string) => {
      const safeId = validateServerId(serverId)
      await mcpService.connectServer(safeId)
      return { success: true }
    },
    {
      label: (serverId: string) => `mcp:connect(${serverId}) failed`,
    },
  )

  // 断开指定 server
  handleIpc(
    IPC.IPC_MCP_DISCONNECT,
    async (_e, serverId: string) => {
      const safeId = validateServerId(serverId)
      await mcpService.disconnectServer(safeId)
      return { success: true }
    },
    {
      label: (serverId: string) => `mcp:disconnect(${serverId}) failed`,
    },
  )

  // 列出指定 server 的工具
  handleIpc(
    IPC.IPC_MCP_LIST_TOOLS,
    async (_e, serverId: string) => {
      const safeId = validateServerId(serverId)
      const tools = await mcpService.listTools(safeId)
      return { success: true, tools }
    },
    {
      onError: (msg) => ({ success: false, tools: [], error: msg }),
      label: (serverId: string) => `mcp:list-tools(${serverId}) failed`,
    },
  )

  // 测试 server 连通性(连接 + listTools)
  handleIpc(
    IPC.IPC_MCP_TEST,
    async (_e, serverId: string) => {
      const safeId = validateServerId(serverId)
      const result = await mcpService.testServer(safeId)
      return result
    },
    {
      onError: (msg) => ({ success: false, toolCount: 0, error: msg }),
      label: (serverId: string) => `mcp:test(${serverId}) failed`,
    },
  )

  // 新增 server
  handleIpc(IPC.IPC_MCP_ADD, async (_e: IpcMainInvokeEvent, config: unknown) => {
    await mcpService.addServer(config as McpServerConfig)
    return { success: true }
  })

  // 更新 server
  handleIpc(
    IPC.IPC_MCP_UPDATE,
    async (_e, id: unknown, patch: unknown) => {
      const safeId = validateServerId(id)
      // R5-2 / 边界 Case 9 修复: 拒绝 null/非对象 patch。
      // 旧实现 (patch || {}) 把 null 静默转成 {} 做 no-op update 并返回 success,
      // 调用方无法区分"传错"与"真的无变化"。这里显式校验。
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('patch must be a non-null object')
      }
      await mcpService.updateServer(safeId, patch as Partial<McpServerConfig>)
      return { success: true }
    },
    {
      label: (id: unknown) => `mcp:update(${id}) failed`,
    },
  )

  // 删除 server
  handleIpc(
    IPC.IPC_MCP_REMOVE,
    async (_e, id: unknown) => {
      const safeId = validateServerId(id)
      await mcpService.removeServer(safeId)
      return { success: true }
    },
    {
      label: (id: unknown) => `mcp:remove(${id}) failed`,
    },
  )

  console.log('[IPC] MCP handlers registered')
}
