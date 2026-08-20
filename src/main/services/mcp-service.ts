// =============================================================
// MCP Service — Model Context Protocol client 管理器(单例) 入口
//
// 实现已按职责拆分至 mcp-management/ 目录:
//   - context.ts         共享上下文(连接池/配置存储/初始化标志)
//   - lifecycle.ts       生命周期(init/reload/connect/disconnect/destroy)
//   - server-crud.ts     服务器 CRUD(list/add/update/remove)
//   - tool-operations.ts 工具发现与调用(listToolsForAgent/callTool/testServer)
//
// 本文件保留 McpService 类入口与单例导出,公共方法签名不变。
//
// Feature flag: settings.mcp.enabled === false 时进入 no-op 模式
//
// 传输方式:
//   - stdio: spawn 子进程 + stdin/stdout JSON-RPC
//   - sse:   HTTP POST + EventSource(MCP SSE 传输)
//   - websocket: ws 库双向通信
//
// 安全屏障复用:
//   - 路径参数走 validateFilePath()(14 个敏感路径黑名单)
//   - 字符串参数走 sanitizeArg()(shell 元字符过滤)
//   详见 mcp-management/tools/(M19: services/mcp-tools.ts 已删除)
// =============================================================

import type { McpServerConfig, McpServerStatus, McpTool } from '@shared/types'
import type { McpCallResult } from './mcp/types'
import { createMcpServiceContext, type McpServiceContext } from './mcp-management/context'
import * as lifecycle from './mcp-management/lifecycle'
import * as serverCrud from './mcp-management/server-crud'
import * as toolOperations from './mcp-management/tool-operations'

class McpService {
  private ctx: McpServiceContext = createMcpServiceContext()

  /**
   * 初始化:加载 mcp.yaml 配置
   * 不实际连接 server(惰性连接,Agent 启用时才连)
   */
  async init(): Promise<void> {
    return lifecycle.init(this.ctx)
  }

  /**
   * 重新加载配置(配置文件变更时调用)。
   *
   * R1-10 / B7 修复: 走 serializeWrite,避免与并发 add/update/remove 竞态
   * (reloadConfig 直接 loadConfig 会用磁盘旧状态覆盖内存新状态)。
   */
  async reloadConfig(): Promise<void> {
    return lifecycle.reloadConfig(this.ctx)
  }

  /**
   * 列出所有配置的 server 及其状态
   */
  listServers(): McpServerStatus[] {
    return serverCrud.listServers(this.ctx)
  }

  /**
   * 新增 server(写入 mcp.user.yaml)
   * 校验:id 唯一、配置合法、command 安全
   */
  async addServer(config: McpServerConfig): Promise<void> {
    return serverCrud.addServer(this.ctx, config)
  }
  /**
   * 更新 server(用户级直接改;全局级复制覆盖到 user)
   */
  async updateServer(id: string, patch: Partial<McpServerConfig>): Promise<void> {
    return serverCrud.updateServer(this.ctx, id, patch)
  }

  /**
   * 删除 server
   * - 纯用户级:从 mcp.user.yaml 删除
   * - 覆盖全局产生的用户级:删除覆盖,恢复全局默认(overrides='global')
   * - 纯全局:拒绝
   */
  async removeServer(id: string): Promise<void> {
    return serverCrud.removeServer(this.ctx, id)
  }
  /**
   * 获取 Agent 可用的所有 MCP 工具
   * 合并三层配置:全局 mcp.yaml + Agent 级 mcpServers + 技能级临时 server
   */
  async listToolsForAgent(
    agentId: string,
    agentMcpServers?: string[],
    skillMcpServers?: McpServerConfig[],
  ): Promise<McpTool[]> {
    return toolOperations.listToolsForAgent(this.ctx, agentId, agentMcpServers, skillMcpServers)
  }

  /**
   * 调用 MCP 工具。
   *
   * R2-2 修复: 若 client 存在但已断开(child exit / ws close),尝试惰性重连一次,
   * 而非直接抛 "not connected" 让调用方永久失败直到重启。
   * 重连失败才抛错。这覆盖了 stdio 子进程崩溃后 Agent 下次调用自动恢复的场景。
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    return toolOperations.callTool(this.ctx, serverId, toolName, args)
  }

  /**
   * 连接指定 server(手动连接,IPC 调用)。
   *
   * R1-10 / B8 修复: 走 serializeWrite,避免与 update 的"先断开再合并"竞态
   * (否则 update 写新配置→断开旧连接之间,connect 可能读新配置连上,随后被 update 的断开杀掉)。
   */
  async connectServer(serverId: string): Promise<void> {
    return lifecycle.connectServer(this.ctx, serverId)
  }

  /**
   * 断开指定 server。
   * 同样走 serializeWrite,与 connect/update 的断开顺序保持一致。
   */
  async disconnectServer(serverId: string): Promise<void> {
    return lifecycle.disconnectServer(this.ctx, serverId)
  }

  /**
   * 列出指定 server 的工具
   */
  async listTools(serverId: string): Promise<McpTool[]> {
    return toolOperations.listTools(this.ctx, serverId)
  }

  /**
   * 测试 server 连通性(连接 + listTools + 不调用任何工具)
   */
  async testServer(
    serverId: string,
  ): Promise<{ success: boolean; toolCount: number; error?: string }> {
    return toolOperations.testServer(this.ctx, serverId)
  }

  /**
   * 清理所有连接(应用退出时调用)
   */
  async destroy(): Promise<void> {
    return lifecycle.destroy(this.ctx)
  }
}

/** 单例 */
export const mcpService = new McpService()
