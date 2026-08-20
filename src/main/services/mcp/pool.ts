// =============================================================
// MCP 连接池 — 类骨架: clients/connecting Map 管理 + 连接编排 + 断开
// 从 mcp-client-pool.ts 拆出。逻辑零修改(逐行对照搬迁)。
//
// 职责边界(其余已拆至同目录):
//   - mcp/pool.ts       本文件: clients Map<serverId, MCPClient> + connecting 互斥锁
//                       + ensureConnected/disconnectAll 连接编排
//   - mcp/connection.ts 单连接生命周期(stdio/sse/ws 传输 + initialize 握手 + 断开清理)
//   - mcp/protocol.ts   JSON-RPC 协议(sendJsonRpc/handleJsonRpcMessage/requestListTools/callToolInternal)
//   - mcp/spawn-env.ts  buildSpawnEnv/resolveSpawnCommand spawn 辅助
//   - 不碰配置(那是 McpConfigStore 的职责)
//
// 历史修复标记全部保留: R1-3/B1(互斥锁)、R5-1/泄漏#2(失败清理)、
// 泄漏#3(disconnectAll)。
// =============================================================

import type { McpServerConfig } from '@shared/types'
import { connectTransport, disconnectClient } from './connection'
import { callToolInternal, requestListTools } from './protocol'
import type { MCPClient } from './types'

export class McpClientPool {
  private clients: Map<string, MCPClient> = new Map()
  /**
   * 每个 serverId 的"正在连接"互斥锁(R1-3 / B1 修复)。
   * 并发 ensureConnected 同一 server 时,后续调用方复用同一个进行中的连接 Promise,
   * 避免产生重复子进程 / 孤儿进程。
   */
  private connecting: Map<string, Promise<MCPClient>> = new Map()

  /** 暴露 clients 给协调器(listServers 读连接状态) */
  get clientsMap(): ReadonlyMap<string, MCPClient> {
    return this.clients
  }

  /** 暴露 connecting 给协调器(update/remove/reload 需清理锁) */
  get connectingMap(): ReadonlyMap<string, Promise<MCPClient>> {
    return this.connecting
  }

  /**
   * 从 clients map 移除指定 server 的条目(供协调器 update/remove/disconnect 后清理)。
   * 仅删 map 条目,不断开连接(断开用 disconnectClient)。clientsMap 是只读视图,
   * 协调器不能直接 delete,必须走此方法。
   */
  deleteClientEntry(serverId: string): void {
    this.clients.delete(serverId)
  }

  /**
   * 清理所有进行中的连接锁(供 reloadConfig/destroy 调用)。
   * R5-1 / 泄漏 #3 修复:避免 inflight doConnect 在 disconnectAll 后又把
   * stale client 插回 this.clients(用旧 config)。
   */
  clearConnectingLocks(): void {
    this.connecting.clear()
  }

  /**
   * 确保 server 已连接(惰性连接)。
   *
   * R1-3 / B1 修复: 用 per-serverId 互斥锁串行化连接。
   * 并发调用同一 server 时,第二个调用方会 await 同一个进行中的连接 Promise,
   * 而不是各自走 check→disconnect→connect 流程(否则会产生重复子进程、孤儿进程)。
   */
  async ensureConnected(server: McpServerConfig): Promise<MCPClient> {
    // 已连接:直接复用
    const existing = this.clients.get(server.id)
    if (existing?.connected) return existing

    // 已有进行中的连接:复用同一 Promise(关键: 防并发重复 spawn)
    const inflight = this.connecting.get(server.id)
    if (inflight) return inflight

    // 发起新连接,把 Promise 缓存,无论成功失败都清理
    const p = this.doConnect(server).finally(() => {
      this.connecting.delete(server.id)
    })
    this.connecting.set(server.id, p)
    return p
  }

  /** ensureConnected 的实际连接实现(由 ensureConnected 保证单线程进入) */
  private async doConnect(server: McpServerConfig): Promise<MCPClient> {
    const existing = this.clients.get(server.id)
    if (existing?.connected) return existing
    if (existing) await disconnectClient(existing)

    const client: MCPClient = {
      serverId: server.id,
      config: server,
      connected: false,
      tools: [],
      requestId: 1,
      pending: new Map(),
    }

    // R5-1 / 泄漏 #2 修复: connectTransport 可能在 spawn/ws.open 之后再失败
    // (initialize 握手超时/错误/transport closed)。此时 client.childProcess/ws 已存在,
    // 但 client 还没进 this.clients,disconnectAll 看不到 → 子进程/ws 泄漏。
    // 这里用 try/catch 包裹,失败时主动 disconnectClient 清理已持有的 transport 资源。
    try {
      await connectTransport(client, server)
    } catch (err) {
      // 清理已 spawn 的子进程 / 已打开的 ws,避免泄漏
      try {
        await disconnectClient(client)
      } catch {
        // 清理失败不掩盖原始连接错误
      }
      throw err
    }
    this.clients.set(server.id, client)

    // 连接成功后列出工具
    try {
      const tools = await requestListTools(client)
      client.tools = tools
      console.log(`[McpService] Server ${server.id} connected, ${tools.length} tools available`)
    } catch (err) {
      console.warn(`[McpService] Server ${server.id} connected but listTools failed:`, err)
      client.lastError = `listTools failed: ${(err as Error).message}`
    }

    return client
  }

  /**
   * 请求工具列表 — 委托 mcp/protocol.ts
   */
  async requestListTools(client: MCPClient) {
    return requestListTools(client)
  }

  /**
   * 内部工具调用实现 — 委托 mcp/protocol.ts
   */
  async callToolInternal(client: MCPClient, toolName: string, args: Record<string, unknown>) {
    return callToolInternal(client, toolName, args)
  }

  /**
   * 断开单个 client — 委托 mcp/connection.ts
   */
  async disconnectClient(client: MCPClient): Promise<void> {
    return disconnectClient(client)
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = []
    for (const [, client] of this.clients) {
      disconnectPromises.push(this.disconnectClient(client))
    }
    await Promise.allSettled(disconnectPromises)
    this.clients.clear()
  }
}
