// =============================================================
// MCP — JSON-RPC 协议: 请求/通知/响应分发 + 工具列表/调用(stdio/ws + SSE)
// 从 mcp-client-pool.ts 拆出。逻辑零修改(逐行对照搬迁)。
// 原私有方法改为模块函数,首参 client 显式传入。
// 历史修复标记全部保留: R1-2/B3(SSE listTools)。
// =============================================================

import type { McpTool } from '@shared/types'
import {
  CALL_TIMEOUT_MS,
  MAX_RESPONSE_SIZE,
  type MCPClient,
  type McpCallResult,
} from '../mcp-types'

/**
 * 发送 JSON-RPC 请求(stdio/websocket)
 */
export function sendJsonRpc(client: MCPClient, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = client.requestId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    const timer = setTimeout(() => {
      client.pending.delete(id)
      reject(new Error(`Request ${method} timeout after ${CALL_TIMEOUT_MS}ms`))
    }, CALL_TIMEOUT_MS)

    client.pending.set(id, { resolve, reject, timer })

    if (client.childProcess?.stdin?.writable) {
      client.childProcess.stdin.write(`${message}\n`)
    } else if (client.ws?.readyState === 1 /* OPEN */) {
      client.ws.send(message)
    } else {
      clearTimeout(timer)
      client.pending.delete(id)
      reject(new Error(`Server ${client.serverId} not writable (transport closed)`))
    }
  })
}

/**
 * 发送 JSON-RPC 通知(无 id,无响应)
 */
export function sendNotification(client: MCPClient, method: string, params: unknown): void {
  const message = JSON.stringify({ jsonrpc: '2.0', method, params })
  if (client.childProcess?.stdin?.writable) {
    client.childProcess.stdin.write(`${message}\n`)
  } else if (client.ws?.readyState === 1) {
    client.ws.send(message)
  }
}

/**
 * 处理 JSON-RPC 响应消息
 */
export function handleJsonRpcMessage(client: MCPClient, raw: string): void {
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    console.warn(`[McpService] Invalid JSON from server ${client.serverId}: ${raw.slice(0, 200)}`)
    return
  }

  const m = msg as { id?: number; result?: unknown; error?: { message: string }; method?: string }
  // 响应(有 id)
  if (m.id !== undefined && client.pending.has(m.id)) {
    const entry = client.pending.get(m.id)
    if (!entry) return
    client.pending.delete(m.id)
    clearTimeout(entry.timer)
    if (m.error) {
      entry.reject(new Error(m.error.message || 'JSON-RPC error'))
    } else {
      entry.resolve(m.result)
    }
  }
  // 通知/请求(无 id 或有 method)— 当前不处理 server→client 请求
}

/**
 * 请求工具列表。
 *
 * R1-2 / B3 修复: SSE 传输没有 stdin/ws 通道,sendJsonRpc 对 SSE 会直接 reject
 * "transport closed",导致 SSE server 静默显示"已连接 0 工具"。
 * 这里对 SSE 单独走 HTTP POST(与 callToolSse 同一通道)。
 */
export async function requestListTools(client: MCPClient): Promise<McpTool[]> {
  const result = await requestListToolsInternal(client)
  const typed = result as {
    tools?: Array<{ name: string; description?: string; inputSchema?: object }>
  }
  if (!typed?.tools) return []
  return typed.tools.map((t) => ({
    serverId: client.serverId,
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || {},
  }))
}

/** requestListTools 的分派实现: SSE 走 HTTP,stdio/websocket 走 JSON-RPC */
async function requestListToolsInternal(client: MCPClient): Promise<unknown> {
  if (client.config.transport === 'sse') {
    return requestSse(client, 'tools/list', {})
  }
  return sendJsonRpc(client, 'tools/list', {})
}

/**
 * SSE 通用 JSON-RPC 请求(HTTP POST)。
 * R1-2 / B3: 让 listTools 与 callTool 共用同一 SSE 通道。
 */
async function requestSse(client: MCPClient, method: string, params: unknown): Promise<unknown> {
  if (!client.config.url) {
    throw new Error(`sse server ${client.serverId} missing url`)
  }
  const response = await fetch(client.config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...client.config.headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: client.requestId++,
      method,
      params,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`SSE ${method} failed: ${response.status} ${response.statusText}`)
  }
  const msg = (await response.json()) as { result?: unknown; error?: { message: string } }
  if (msg.error) throw new Error(msg.error.message)
  return msg.result
}

/**
 * 内部工具调用实现
 */
export async function callToolInternal(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  // SSE 传输使用 HTTP POST
  if (client.config.transport === 'sse') {
    return callToolSse(client, toolName, args)
  }

  // stdio / websocket 使用 JSON-RPC
  const result = (await sendJsonRpc(client, 'tools/call', {
    name: toolName,
    arguments: args,
  })) as McpCallResult | undefined

  if (!result) {
    return { content: [{ type: 'text', text: '(empty result)' }] }
  }

  // 大小限制
  const resultStr = JSON.stringify(result)
  if (resultStr.length > MAX_RESPONSE_SIZE) {
    return {
      content: [
        {
          type: 'text',
          text: `响应过大 (${(resultStr.length / 1024 / 1024).toFixed(1)} MB),超过 ${MAX_RESPONSE_SIZE / 1024 / 1024} MB 上限`,
        },
      ],
      isError: true,
    }
  }

  return result
}

/**
 * SSE 工具调用(HTTP POST)
 */
async function callToolSse(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  if (!client.config.url) {
    throw new Error(`sse server ${client.serverId} missing url`)
  }
  const response = await fetch(client.config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...client.config.headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: client.requestId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`SSE callTool ${toolName} failed: ${response.status}`)
  }

  const msg = (await response.json()) as { result?: McpCallResult; error?: { message: string } }
  if (msg.error) throw new Error(msg.error.message)
  return msg.result || { content: [{ type: 'text', text: '(empty)' }] }
}
