// =============================================================
// MCP 生命周期管理 — 初始化/重载/连接/断开/销毁
//
// 职责:
//   - init: 加载 mcp.yaml 配置(惰性连接,不实际连 server)
//   - reloadConfig: 配置文件变更时重载(走 serializeWrite 防竞态)
//   - connectServer / disconnectServer: 手动连接/断开(IPc 调用)
//   - destroy: 清理所有连接(应用退出时调用)
//
// Feature flag: settings.mcp.enabled === false 时进入 no-op 模式
// =============================================================

import { settingsService } from '../settings-service'
import type { McpServiceContext } from './context'

/**
 * 初始化:加载 mcp.yaml 配置
 * 不实际连接 server(惰性连接,Agent 启用时才连)
 */
export async function init(ctx: McpServiceContext): Promise<void> {
  if (ctx.initialized) return

  // Feature flag 检查
  const settings = settingsService.getSettings()
  const mcpEnabled = settings?.mcp?.enabled === true
  if (!mcpEnabled) {
    console.log('[McpService] MCP feature flag disabled, entering no-op mode')
    ctx.initialized = true
    return
  }

  await ctx.configStore.loadConfig()
  ctx.initialized = true
  console.log(`[McpService] Initialized with ${ctx.configStore.configList.length} server configs`)
}

/**
 * 重新加载配置(配置文件变更时调用)。
 *
 * R1-10 / B7 修复: 走 serializeWrite,避免与并发 add/update/remove 竞态
 * (reloadConfig 直接 loadConfig 会用磁盘旧状态覆盖内存新状态)。
 */
export async function reloadConfig(ctx: McpServiceContext): Promise<void> {
  return ctx.configStore.serializeWrite(async () => {
    // 断开所有现有连接
    await ctx.clientPool.disconnectAll()
    // R5-1 / 泄漏 #3 修复: 清理进行中的连接锁,避免 inflight doConnect 在
    // disconnectAll 后又把 stale client 插回 this.clients(用旧 config)。
    ctx.clientPool.clearConnectingLocks()
    ctx.configStore.resetConfig()
    ctx.initialized = false
    await init(ctx)
  })
}

/**
 * 连接指定 server(手动连接,IPC 调用)。
 *
 * R1-10 / B8 修复: 走 serializeWrite,避免与 update 的"先断开再合并"竞态
 * (否则 update 写新配置→断开旧连接之间,connect 可能读新配置连上,随后被 update 的断开杀掉)。
 */
export async function connectServer(ctx: McpServiceContext, serverId: string): Promise<void> {
  return ctx.configStore.serializeWrite(async () => {
    const serverConfig = ctx.configStore.configList.find((s) => s.id === serverId)
    if (!serverConfig) {
      throw new Error(`MCP server ${serverId} not found in config`)
    }
    await ctx.clientPool.ensureConnected(serverConfig)
  })
}

/**
 * 断开指定 server。
 * 同样走 serializeWrite,与 connect/update 的断开顺序保持一致。
 */
export async function disconnectServer(ctx: McpServiceContext, serverId: string): Promise<void> {
  return ctx.configStore.serializeWrite(async () => {
    // 若该 server 正在连接中,先等连接结束再断开,避免留下半连接
    const inflight = ctx.clientPool.connectingMap.get(serverId)
    if (inflight) {
      try {
        await inflight
      } catch {
        // 连接失败也无所谓,下面正常清理
      }
    }
    const client = ctx.clientPool.clientsMap.get(serverId)
    if (!client) return
    await ctx.clientPool.disconnectClient(client)
    ctx.clientPool.deleteClientEntry(serverId)
  })
}

/**
 * 清理所有连接(应用退出时调用)
 */
export async function destroy(ctx: McpServiceContext): Promise<void> {
  console.log(`[McpService] destroy() — disconnecting ${ctx.clientPool.clientsMap.size} servers`)
  await ctx.clientPool.disconnectAll()
  // R1-3: 清理可能残留的连接锁(正常情况 finally 已清,这里兜底防止 reloadConfig 循环累积)
  ctx.clientPool.clearConnectingLocks()
  ctx.configStore.resetConfig()
  ctx.initialized = false
}
