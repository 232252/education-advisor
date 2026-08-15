// =============================================================
// Preload API — MCP (Model Context Protocol) 域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const mcpApi = {
  // [r] 列出所有配置的 MCP server 及连接状态
  list: () => ipcRenderer.invoke(IPC.IPC_MCP_LIST),
  // [w] 手动连接指定 MCP server
  connect: (serverId: string) => ipcRenderer.invoke(IPC.IPC_MCP_CONNECT, serverId),
  // [w] 断开指定 MCP server
  disconnect: (serverId: string) => ipcRenderer.invoke(IPC.IPC_MCP_DISCONNECT, serverId),
  // [r] 列出指定 MCP server 的工具
  listTools: (serverId: string) => ipcRenderer.invoke(IPC.IPC_MCP_LIST_TOOLS, serverId),
  // [c] 测试 MCP server 连通性
  test: (serverId: string) => ipcRenderer.invoke(IPC.IPC_MCP_TEST, serverId),
  // [w] 新增 MCP server (写入 mcp.user.yaml)
  add: (config: unknown) => ipcRenderer.invoke(IPC.IPC_MCP_ADD, config),
  // [w] 更新 MCP server (用户级直接改 / 全局级复制覆盖)
  update: (serverId: string, patch: unknown) =>
    ipcRenderer.invoke(IPC.IPC_MCP_UPDATE, serverId, patch),
  // [w] 删除 MCP server (纯用户级 / 覆盖项恢复全局默认)
  remove: (serverId: string) => ipcRenderer.invoke(IPC.IPC_MCP_REMOVE, serverId),
}
