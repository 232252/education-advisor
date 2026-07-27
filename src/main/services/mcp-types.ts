// =============================================================
// MCP 共享类型 + 常量 + 安全断言
// 从 mcp-service.ts 抽出,供 config-store / client-pool / service 共享。
// 逻辑零修改(逐行对照搬迁)。
// =============================================================

import type { ChildProcess } from 'node:child_process'
import type { McpServerConfig, McpTool } from '../../shared/types'
import { isSafeMcpUrl } from './mcp-helpers'

/** MCP 工具调用结果(兼容 MCP 协议) */
export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** 单个 MCP client 连接 */
export interface MCPClient {
  serverId: string
  config: McpServerConfig
  connected: boolean
  tools: McpTool[]
  lastError?: string
  // stdio
  childProcess?: ChildProcess
  // websocket
  ws?: import('ws').WebSocket
  // 请求计数器(JSON-RPC id)
  requestId: number
  // 待响应请求 Map
  pending: Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >
  // 接收缓冲区(stdio 按行解析)
  buffer?: string
}

/** 连接超时(毫秒) */
export const CONNECT_TIMEOUT_MS = 30_000
/** server id 格式(与 mcp-handlers.ts validateServerId 一致) */
export const SERVER_ID_RE = /^[a-zA-Z0-9_-]+$/
/** 工具调用超时(毫秒) */
export const CALL_TIMEOUT_MS = 60_000
/** 返回内容最大大小(5MB,防止超大响应撑爆上下文) */
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024

/**
 * SSRF 防护断言(薄封装,逻辑在 mcp-helpers.isSafeMcpUrl 纯函数,便于单测)。
 * R4-SSRF-1 修复:防止 sidecar 被诱导连接云元数据服务或扫描内网。
 */
export function assertSafeMcpUrl(rawUrl: string | undefined, serverId: string): void {
  if (!isSafeMcpUrl(rawUrl)) {
    throw new Error(
      `MCP server ${serverId} url refused (SSRF protection): ${rawUrl ?? '(missing)'}`,
    )
  }
}
