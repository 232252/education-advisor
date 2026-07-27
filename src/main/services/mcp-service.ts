// =============================================================
// MCP Service — Model Context Protocol client 管理器(单例)
//
// 职责:
//   - 加载 config/mcp.yaml 全局配置(含环境变量插值)
//   - 管理 MCP client 连接池(Map<serverId, MCPClient>)
//   - 按需连接/断开 server(stdio spawn / SSE / WebSocket)
//   - 提供 listToolsForAgent() 和 callTool()
//   - 生命周期管理:初始化、重连、超时、清理
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
//   详见 mcp-tools.ts
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { McpServerConfig, McpServerStatus, McpTool } from '../../shared/types'
import { McpClientPool } from './mcp-client-pool'
import { McpConfigStore } from './mcp-config-store'
import { isSafeMcpUrl, sanitizeObject, validateCommandSafe } from './mcp-helpers'
import type { McpCallResult } from './mcp-types'
import { settingsService } from './settings-service'

class McpService {
  private clientPool: McpClientPool
  private configStore: McpConfigStore
  private configPath: string
  private initialized = false

  constructor() {
    const devConfigDir = path.join(__dirname, '..', '..', 'config')
    const prodConfigDir = path.join(process.resourcesPath || '', 'config')
    const configDir = fs.existsSync(devConfigDir) ? devConfigDir : prodConfigDir
    this.configPath = path.join(configDir, 'mcp.yaml')
    this.configStore = new McpConfigStore(this.configPath)
    this.clientPool = new McpClientPool()
  }

  /**
   * 初始化:加载 mcp.yaml 配置
   * 不实际连接 server(惰性连接,Agent 启用时才连)
   */
  async init(): Promise<void> {
    if (this.initialized) return

    // Feature flag 检查
    const settings = settingsService.getSettings()
    const mcpEnabled = settings?.mcp?.enabled === true
    if (!mcpEnabled) {
      console.log('[McpService] MCP feature flag disabled, entering no-op mode')
      this.initialized = true
      return
    }

    await this.configStore.loadConfig()
    this.initialized = true
    console.log(
      `[McpService] Initialized with ${this.configStore.configList.length} server configs`,
    )
  }
  /**
   * 重新加载配置(配置文件变更时调用)。
   *
   * R1-10 / B7 修复: 走 serializeWrite,避免与并发 add/update/remove 竞态
   * (reloadConfig 直接 loadConfig 会用磁盘旧状态覆盖内存新状态)。
   */
  async reloadConfig(): Promise<void> {
    return this.configStore.serializeWrite(async () => {
      // 断开所有现有连接
      await this.clientPool.disconnectAll()
      // R5-1 / 泄漏 #3 修复: 清理进行中的连接锁,避免 inflight doConnect 在
      // disconnectAll 后又把 stale client 插回 this.clients(用旧 config)。
      this.clientPool.clearConnectingLocks()
      this.configStore.resetConfig()
      this.initialized = false
      await this.init()
    })
  }

  /**
   * 列出所有配置的 server 及其状态
   */
  listServers(): McpServerStatus[] {
    return this.configStore.configList.map((c) => {
      const client = this.clientPool.clientsMap.get(c.id)
      return {
        id: c.id,
        name: c.name,
        connected: client?.connected ?? false,
        toolCount: client?.tools.length ?? 0,
        lastError: client?.lastError,
        transport: c.transport,
        source: c.source ?? 'global',
        enabled: c.enabled,
      }
    })
  }

  /**
   * 新增 server(写入 mcp.user.yaml)
   * 校验:id 唯一、配置合法、command 安全
   */
  async addServer(config: McpServerConfig): Promise<void> {
    return this.configStore.addServer(config)
  }
  /**
   * 更新 server(用户级直接改;全局级复制覆盖到 user)
   */
  async updateServer(id: string, patch: Partial<McpServerConfig>): Promise<void> {
    return this.configStore.serializeWrite(() => this.updateServerInternal(id, patch))
  }

  /** updateServer 的串行化实现 */
  private async updateServerInternal(id: string, patch: Partial<McpServerConfig>): Promise<void> {
    const existing = this.configStore.configList.find((s) => s.id === id)
    if (!existing) throw new Error(`Server ${id} not found`)

    // 若 command 被改,校验安全性
    if (patch.command !== undefined && !validateCommandSafe(patch.command)) {
      throw new Error(`Server ${id} command failed safety check`)
    }

    // R5-ERR-2 修复: patch 含 url → 校验 SSRF;
    // patch 改为非 stdio transport → 校验 existing.url(新 transport 会用到它)
    // 注意:patch 同时含 transport + url 时,patch.url 优先(校验 patch.url 即可)
    if (patch.url !== undefined) {
      if (!isSafeMcpUrl(patch.url)) {
        throw new Error(`Server ${id} url failed SSRF check`)
      }
    } else if (
      patch.transport !== undefined &&
      patch.transport !== 'stdio' &&
      !isSafeMcpUrl(existing.url)
    ) {
      throw new Error(`Server ${id} url failed SSRF check`)
    }

    // 若正在连接,先断开(新配置下次连接生效)。
    // 注意: 这里直接调 disconnectClient 而非 disconnectServer,因为本方法已运行在
    // serializeWrite 队列内,若再调 disconnectServer(也入队)会造成队列自等待死锁。
    if (this.clientPool.clientsMap.has(id)) {
      const inflight = this.clientPool.connectingMap.get(id)
      if (inflight) {
        try {
          await inflight
        } catch {
          // 忽略连接失败,继续清理
        }
      }
      const client = this.clientPool.clientsMap.get(id)
      if (client) {
        await this.clientPool.disconnectClient(client)
        this.clientPool.deleteClientEntry(id)
      }
    }

    const userServers = await this.configStore.readUserConfig()
    const userIdx = userServers.findIndex((s) => s.id === id)

    // R1-5 / B5 修复: 净化 patch 的原型污染 key,再 spread 合并
    const safePatch = sanitizeObject({ ...patch })
    if (existing.source === 'user' || userIdx >= 0) {
      // 已是用户级(或覆盖过),直接 patch user 配置中的对应条目
      if (userIdx >= 0) {
        userServers[userIdx] = sanitizeObject({
          ...userServers[userIdx],
          ...safePatch,
          source: 'user' as const,
        })
      } else {
        // 内存中是 user 但文件里没有(异常情况),追加
        userServers.push(sanitizeObject({ ...existing, ...safePatch, source: 'user' as const }))
      }
    } else {
      // 全局项首次覆盖:复制到 user 级 + 应用 patch + 标记 overrides
      userServers.push(
        sanitizeObject({
          ...existing,
          ...safePatch,
          source: 'user' as const,
          overrides: 'global' as const,
        }),
      )
    }
    await this.configStore.writeUserConfig(userServers)

    // 更新内存 config
    const idx = this.configStore.configList.findIndex((s) => s.id === id)
    if (idx >= 0) {
      this.configStore.configList[idx] = sanitizeObject({
        ...this.configStore.configList[idx],
        ...safePatch,
        source: 'user' as const,
      })
    }
    console.log(`[McpService] Updated server ${id}`)
  }

  /**
   * 删除 server
   * - 纯用户级:从 mcp.user.yaml 删除
   * - 覆盖全局产生的用户级:删除覆盖,恢复全局默认(overrides='global')
   * - 纯全局:拒绝
   */
  async removeServer(id: string): Promise<void> {
    return this.configStore.serializeWrite(() => this.removeServerInternal(id))
  }

  /** removeServer 的串行化实现 */
  private async removeServerInternal(id: string): Promise<void> {
    const existing = this.configStore.configList.find((s) => s.id === id)
    if (!existing) throw new Error(`Server ${id} not found`)

    // 断开连接。
    // 同 updateServerInternal: 不调 disconnectServer(避免队列自等待),直接清理。
    if (this.clientPool.clientsMap.has(id)) {
      const inflight = this.clientPool.connectingMap.get(id)
      if (inflight) {
        try {
          await inflight
        } catch {
          // 忽略连接失败,继续清理
        }
      }
      const client = this.clientPool.clientsMap.get(id)
      if (client) {
        await this.clientPool.disconnectClient(client)
        this.clientPool.deleteClientEntry(id)
      }
    }

    const userServers = await this.configStore.readUserConfig()
    const userIdx = userServers.findIndex((s) => s.id === id)

    if (userIdx < 0) {
      // 不在 user yaml 里 = 纯全局项
      throw new Error(`Server ${id} is global (read-only), cannot remove`)
    }

    const userEntry = userServers[userIdx]
    userServers.splice(userIdx, 1)
    await this.configStore.writeUserConfig(userServers)

    // 更新内存
    if (userEntry.overrides === 'global') {
      // 恢复全局默认:重新加载该项
      const globalServers = await this.configStore.loadConfigFile(this.configPath, 'global')
      const globalEntry = globalServers.find((s) => s.id === id)
      const idx = this.configStore.configList.findIndex((s) => s.id === id)
      if (globalEntry && idx >= 0) {
        this.configStore.configList[idx] = globalEntry
      } else if (idx >= 0) {
        this.configStore.configList.splice(idx, 1)
      }
      console.log(`[McpService] Removed override for ${id}, restored global default`)
    } else {
      // 纯用户级,直接从内存删除
      const idx = this.configStore.configList.findIndex((s) => s.id === id)
      if (idx >= 0) this.configStore.configList.splice(idx, 1)
      console.log(`[McpService] Removed server ${id}`)
    }
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
    if (!this.initialized) await this.init()

    // Feature flag 关闭时返回空
    const settings = settingsService.getSettings()
    if (settings?.mcp?.enabled !== true) return []

    // 合并 server 列表:Agent 级引用全局 + 技能级临时
    const serversToConnect: McpServerConfig[] = []

    // 1. Agent 级启用的全局 server
    if (agentMcpServers && agentMcpServers.length > 0) {
      for (const serverId of agentMcpServers) {
        const globalServer = this.configStore.configList.find((s) => s.id === serverId)
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
    // ⚠️ 未接线(NOT WIRED): 此分支目前是死代码。
    //   - skill-service.ts 不解析 SKILL.md frontmatter 的 mcp_servers 字段
    //   - agent-service.ts:699 调 getMcpToolsForAgent 时只传 2 个参数,第三参恒为 undefined
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
        const client = await this.clientPool.ensureConnected(server)
        allTools.push(...client.tools)
      } catch (err) {
        console.warn(
          `[McpService] Failed to connect server ${server.id} for agent ${agentId}:`,
          err,
        )
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
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    let client = this.clientPool.clientsMap.get(serverId)
    if (!client?.connected) {
      // 惰性重连: 找到配置则重连,无配置才抛错
      const serverConfig = this.configStore.configList.find((s) => s.id === serverId)
      if (!serverConfig) {
        throw new Error(`MCP server ${serverId} not connected and no config to reconnect`)
      }
      try {
        client = await this.clientPool.ensureConnected(serverConfig)
      } catch (err) {
        throw new Error(`MCP server ${serverId} reconnect failed: ${(err as Error).message}`)
      }
    }
    return this.clientPool.callToolInternal(client, toolName, args)
  }

  /**
   * 连接指定 server(手动连接,IPC 调用)。
   *
   * R1-10 / B8 修复: 走 serializeWrite,避免与 update 的"先断开再合并"竞态
   * (否则 update 写新配置→断开旧连接之间,connect 可能读新配置连上,随后被 update 的断开杀掉)。
   */
  async connectServer(serverId: string): Promise<void> {
    return this.configStore.serializeWrite(async () => {
      const serverConfig = this.configStore.configList.find((s) => s.id === serverId)
      if (!serverConfig) {
        throw new Error(`MCP server ${serverId} not found in config`)
      }
      await this.clientPool.ensureConnected(serverConfig)
    })
  }

  /**
   * 断开指定 server。
   * 同样走 serializeWrite,与 connect/update 的断开顺序保持一致。
   */
  async disconnectServer(serverId: string): Promise<void> {
    return this.configStore.serializeWrite(async () => {
      // 若该 server 正在连接中,先等连接结束再断开,避免留下半连接
      const inflight = this.clientPool.connectingMap.get(serverId)
      if (inflight) {
        try {
          await inflight
        } catch {
          // 连接失败也无所谓,下面正常清理
        }
      }
      const client = this.clientPool.clientsMap.get(serverId)
      if (!client) return
      await this.clientPool.disconnectClient(client)
      this.clientPool.deleteClientEntry(serverId)
    })
  }

  /**
   * 列出指定 server 的工具
   */
  async listTools(serverId: string): Promise<McpTool[]> {
    const client = this.clientPool.clientsMap.get(serverId)
    if (!client?.connected) return []
    return client.tools
  }

  /**
   * 测试 server 连通性(连接 + listTools + 不调用任何工具)
   */
  async testServer(
    serverId: string,
  ): Promise<{ success: boolean; toolCount: number; error?: string }> {
    try {
      const serverConfig = this.configStore.configList.find((s) => s.id === serverId)
      if (!serverConfig) {
        return { success: false, toolCount: 0, error: `Server ${serverId} not found` }
      }
      const client = await this.clientPool.ensureConnected(serverConfig)
      return { success: true, toolCount: client.tools.length }
    } catch (err) {
      return { success: false, toolCount: 0, error: (err as Error).message }
    }
  }

  /**
   * 清理所有连接(应用退出时调用)
   */
  async destroy(): Promise<void> {
    console.log(`[McpService] destroy() — disconnecting ${this.clientPool.clientsMap.size} servers`)
    await this.clientPool.disconnectAll()
    // R1-3: 清理可能残留的连接锁(正常情况 finally 已清,这里兜底防止 reloadConfig 循环累积)
    this.clientPool.clearConnectingLocks()
    this.configStore.resetConfig()
    this.initialized = false
  }
}

/** 单例 */
export const mcpService = new McpService()
