// =============================================================
// MCP 服务器 CRUD — server 的查询/新增/更新/删除
//
// 职责:
//   - listServers: 列出所有配置的 server 及其状态
//   - addServer: 新增 server(写入 mcp.user.yaml)
//   - updateServer: 更新 server(用户级直接改;全局级复制覆盖到 user)
//   - removeServer: 删除 server(纯用户级删除/覆盖恢复全局默认)
//
// 注意: update/remove 的串行化实现不调 disconnectServer(也入队),
//   以免在 serializeWrite 队列内自等待死锁(与原实现一致)。
// =============================================================

import type { McpServerConfig, McpServerStatus } from '@shared/types'
import { isSafeMcpUrl, sanitizeObject, validateCommandSafe } from '../mcp-helpers'
import type { McpServiceContext } from './context'

/**
 * 列出所有配置的 server 及其状态
 */
export function listServers(ctx: McpServiceContext): McpServerStatus[] {
  return ctx.configStore.configList.map((c) => {
    const client = ctx.clientPool.clientsMap.get(c.id)
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
export async function addServer(ctx: McpServiceContext, config: McpServerConfig): Promise<void> {
  return ctx.configStore.addServer(config)
}

/**
 * 更新 server(用户级直接改;全局级复制覆盖到 user)
 */
export async function updateServer(
  ctx: McpServiceContext,
  id: string,
  patch: Partial<McpServerConfig>,
): Promise<void> {
  return ctx.configStore.serializeWrite(() => updateServerInternal(ctx, id, patch))
}

/** updateServer 的串行化实现 */
async function updateServerInternal(
  ctx: McpServiceContext,
  id: string,
  patch: Partial<McpServerConfig>,
): Promise<void> {
  const existing = ctx.configStore.configList.find((s) => s.id === id)
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
  if (ctx.clientPool.clientsMap.has(id)) {
    const inflight = ctx.clientPool.connectingMap.get(id)
    if (inflight) {
      try {
        await inflight
      } catch {
        // 忽略连接失败,继续清理
      }
    }
    const client = ctx.clientPool.clientsMap.get(id)
    if (client) {
      await ctx.clientPool.disconnectClient(client)
      ctx.clientPool.deleteClientEntry(id)
    }
  }

  const userServers = await ctx.configStore.readUserConfig()
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
  await ctx.configStore.writeUserConfig(userServers)

  // 更新内存 config
  const idx = ctx.configStore.configList.findIndex((s) => s.id === id)
  if (idx >= 0) {
    ctx.configStore.configList[idx] = sanitizeObject({
      ...ctx.configStore.configList[idx],
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
export async function removeServer(ctx: McpServiceContext, id: string): Promise<void> {
  return ctx.configStore.serializeWrite(() => removeServerInternal(ctx, id))
}

/** removeServer 的串行化实现 */
async function removeServerInternal(ctx: McpServiceContext, id: string): Promise<void> {
  const existing = ctx.configStore.configList.find((s) => s.id === id)
  if (!existing) throw new Error(`Server ${id} not found`)

  // 断开连接。
  // 同 updateServerInternal: 不调 disconnectServer(避免队列自等待),直接清理。
  if (ctx.clientPool.clientsMap.has(id)) {
    const inflight = ctx.clientPool.connectingMap.get(id)
    if (inflight) {
      try {
        await inflight
      } catch {
        // 忽略连接失败,继续清理
      }
    }
    const client = ctx.clientPool.clientsMap.get(id)
    if (client) {
      await ctx.clientPool.disconnectClient(client)
      ctx.clientPool.deleteClientEntry(id)
    }
  }

  const userServers = await ctx.configStore.readUserConfig()
  const userIdx = userServers.findIndex((s) => s.id === id)

  if (userIdx < 0) {
    // 不在 user yaml 里 = 纯全局项
    throw new Error(`Server ${id} is global (read-only), cannot remove`)
  }

  const userEntry = userServers[userIdx]
  userServers.splice(userIdx, 1)
  await ctx.configStore.writeUserConfig(userServers)

  // 更新内存
  if (userEntry.overrides === 'global') {
    // 恢复全局默认:重新加载该项
    const globalServers = await ctx.configStore.loadConfigFile(ctx.configPath, 'global')
    const globalEntry = globalServers.find((s) => s.id === id)
    const idx = ctx.configStore.configList.findIndex((s) => s.id === id)
    if (globalEntry && idx >= 0) {
      ctx.configStore.configList[idx] = globalEntry
    } else if (idx >= 0) {
      ctx.configStore.configList.splice(idx, 1)
    }
    console.log(`[McpService] Removed override for ${id}, restored global default`)
  } else {
    // 纯用户级,直接从内存删除
    const idx = ctx.configStore.configList.findIndex((s) => s.id === id)
    if (idx >= 0) ctx.configStore.configList.splice(idx, 1)
    console.log(`[McpService] Removed server ${id}`)
  }
}
