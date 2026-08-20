// =============================================================
// MCP Service 共享上下文 — McpService 各职责模块的公共依赖容器
//
// 职责:
//   - 持有 McpClientPool(连接池)与 McpConfigStore(配置持久化)实例
//   - 持有 mcp.yaml 路径与初始化标志
//   - 由 mcp-service.ts 入口创建,传递给各职责模块(server-crud/lifecycle/tool-operations)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { McpClientPool } from '../mcp/pool'
import { McpConfigStore } from './config-store'

/** McpService 的共享状态与依赖 */
export interface McpServiceContext {
  /** MCP client 连接池 */
  clientPool: McpClientPool
  /** 配置持久化(mcp.yaml / mcp.user.yaml) */
  configStore: McpConfigStore
  /** mcp.yaml 配置文件路径 */
  configPath: string
  /** 是否已初始化 */
  initialized: boolean
}

/** 创建服务上下文(原 McpService 构造函数逻辑,逐字搬移) */
export function createMcpServiceContext(): McpServiceContext {
  // 注: 本文件位于 services/mcp-management/ 下,比原 mcp-service.ts 深一层,
  // 故相对 __dirname 多回退一级,保证解析到同一 config 目录
  const devConfigDir = path.join(__dirname, '..', '..', '..', 'config')
  const prodConfigDir = path.join(process.resourcesPath || '', 'config')
  const configDir = fs.existsSync(devConfigDir) ? devConfigDir : prodConfigDir
  const configPath = path.join(configDir, 'mcp.yaml')
  const configStore = new McpConfigStore(configPath)
  const clientPool = new McpClientPool()
  return { configStore, clientPool, configPath, initialized: false }
}
