// =============================================================
// MCP 配置管理层 — 配置加载/合并/查询/纯新增/持久化
// 从 mcp-service.ts 抽出。逻辑零修改(逐行对照搬迁)。
//
// 职责边界:
//   - 只管配置(内存 config[] + mcp.user.yaml 读写)
//   - 不碰连接状态(那是 McpClientPool 的职责)
//   - update/remove 因涉及"改配置 + 断开已连接 client"的协调(且在 serializeWrite
//     队列内直接操作 clients 以避免死锁),留在 McpService 协调器,不在此处。
//
// Feature flag 不在此层(由协调器 init 时检查 settings.mcp.enabled)。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { McpServerConfig } from '@shared/types'
import { app } from 'electron'
import yaml from 'yaml'
import { atomicWrite } from '../../utils/atomic-write'
import { SERVER_ID_RE } from '../mcp/types'
import {
  deepInterpolate,
  isSafeMcpUrl,
  sanitizeObject,
  validateCommandSafe,
  validateServerConfig,
} from './helpers'

export class McpConfigStore {
  private config: McpServerConfig[] = []
  private readonly configPath: string
  /** 写操作串行队列(防止 add 并发竞态)。update/remove 也走此队列(在协调器)。 */
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(configPath: string) {
    this.configPath = configPath
  }

  /** 当前内存中的配置列表(只读视图) */
  get configList(): McpServerConfig[] {
    return this.config
  }

  /** 按 id 查找 server 配置 */
  findServer(id: string): McpServerConfig | undefined {
    return this.config.find((s) => s.id === id)
  }

  /**
   * 加载配置:全局 mcp.yaml + 用户级 mcp.user.yaml(用户覆盖全局同 id)
   */
  async loadConfig(): Promise<void> {
    const globalServers = await this.loadConfigFile(this.configPath, 'global')
    // 每次加载时按当前 userData 解析,避免单例构造期缓存过期路径
    const userPath = path.join(app.getPath('userData'), 'mcp.user.yaml')
    const userServers = await this.loadConfigFile(userPath, 'user')

    // 合并:用户级整条覆盖同 id 的全局项
    const byId = new Map<string, McpServerConfig>()
    for (const s of globalServers) byId.set(s.id, s)
    for (const s of userServers) byId.set(s.id, s) // user 覆盖 global
    this.config = Array.from(byId.values())
    console.log(
      `[McpConfigStore] Loaded ${globalServers.length} global + ${userServers.length} user servers → ${this.config.length} total`,
    )
  }

  /**
   * 读单个 yaml 文件并解析为带 source 标记的 server 列表
   */
  async loadConfigFile(filePath: string, source: 'global' | 'user'): Promise<McpServerConfig[]> {
    try {
      const content = await fsp.readFile(filePath, 'utf-8')
      const parsed = yaml.parse(content)
      const servers = parsed?.servers
      if (!Array.isArray(servers)) return []
      // R1-10 / B6 修复: 这里不再 .filter((s) => s.enabled) —— 否则 addServer 写入的
      // enabled:false server 在下次 reloadConfig/loadConfig 时会被静默丢弃,造成
      // 内存与磁盘不一致。enabled 由 UI 层展示开关,listServers 仍列出全部以便用户重新启用。
      return servers
        .filter(validateServerConfig)
        .map((s) => deepInterpolate(sanitizeObject({ ...s, source })))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      console.warn(`[McpConfigStore] Failed to load ${filePath}:`, err)
      return []
    }
  }

  /**
   * 读取 mcp.user.yaml 的 server 列表(不过滤 enabled,保留全部以便编辑)
   */
  async readUserConfig(): Promise<McpServerConfig[]> {
    try {
      const userPath = path.join(app.getPath('userData'), 'mcp.user.yaml')
      const content = await fsp.readFile(userPath, 'utf-8')
      const parsed = yaml.parse(content)
      const servers = parsed?.servers
      if (!Array.isArray(servers)) return []
      return servers.filter(validateServerConfig)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      console.warn('[McpConfigStore] Failed to read user config:', err)
      return []
    }
  }

  /**
   * 写入 mcp.user.yaml(原子写:tmp + rename)
   */
  async writeUserConfig(servers: McpServerConfig[]): Promise<void> {
    // 大小上限 1MB
    const payload = `\
# Education Advisor MCP 用户配置
# 此文件由 UI 自动生成,主配置文件 config/mcp.yaml 不会被修改
# 仅记录用户添加或覆盖的 MCP server
${yaml.stringify({ servers })}
`
    if (Buffer.byteLength(payload, 'utf-8') > 1024 * 1024) {
      throw new Error('mcp.user.yaml exceeds 1MB limit')
    }
    const userPath = path.join(app.getPath('userData'), 'mcp.user.yaml')
    await atomicWrite(userPath, payload, 'utf-8')
  }

  /**
   * 新增 server(写入 mcp.user.yaml)。校验:id 唯一、配置合法、command/url 安全。
   * 串行化执行(serializeWrite)。
   */
  async addServer(config: McpServerConfig): Promise<void> {
    return this.serializeWrite(() => this.addServerInternal(config))
  }

  /** addServer 的串行化实现 */
  private async addServerInternal(config: McpServerConfig): Promise<void> {
    if (!validateServerConfig(config)) {
      throw new Error('Invalid server config')
    }
    // R4-EDGE-MCP-ID 修复: id 格式校验,与 mcp-handlers.ts 的 validateServerId 一致
    // 防止 add 接受非法 id 但 remove/update 拒绝,形成不可删除的脏配置
    if (!SERVER_ID_RE.test(config.id)) {
      throw new Error(
        `Server id "${config.id}" contains invalid characters (only a-zA-Z0-9_- allowed)`,
      )
    }
    if (this.config.some((s) => s.id === config.id)) {
      throw new Error(`Server ${config.id} already exists`)
    }
    if (config.transport === 'stdio' && !validateCommandSafe(config.command)) {
      throw new Error(`Server ${config.id} command failed safety check`)
    }
    // R5-ERR-2 修复: sse/websocket 的 URL 在 add 时也校验 SSRF(不只是 connect 时),
    // 防止 file:// 等危险 URL 写入 mcp.user.yaml
    if (config.transport !== 'stdio' && !isSafeMcpUrl(config.url)) {
      throw new Error(`Server ${config.id} url failed SSRF check`)
    }
    // 读取现有 user 配置 + 追加
    const userServers = await this.readUserConfig()
    // R1-5 / B5 修复: 净化原型污染 key 后再落盘/合并,防止 __proto__ 等注入
    const newServer: McpServerConfig = sanitizeObject({ ...config, source: 'user' as const })
    userServers.push(newServer)
    await this.writeUserConfig(userServers)
    // 更新内存
    this.config.push(newServer)
    console.log(`[McpConfigStore] Added server ${config.id}`)
  }

  /**
   * 把写操作串行化执行(防止并发 add/update/remove 竞态)
   * 每个操作等前一个完成后再开始
   *
   * 关键:
   *   - run = writeQueue.then(fn, fn) — 即使前一个操作 reject,本操作也能基于
   *     已 settle 的队列开始(reject/recover 都会触发 .then 的第2个 handler)
   *   - writeQueue = run.then(_, _)  — 即使本操作 reject,后续操作依然能排队
   *     (catch 会吞掉 reject,否则后续 addServer 会卡死)
   *
   * update/remove(在协调器)也复用此队列以保证与 add 的互斥。
   */
  serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn, fn)
    // 关键: 即使 fn 失败也要让队列继续(reject 不应阻塞后续操作)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 供协调器 reloadConfig 时重置内存配置 */
  resetConfig(): void {
    this.config = []
  }
}
