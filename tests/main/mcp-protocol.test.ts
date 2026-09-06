// =============================================================
// MCP protocol — JSON-RPC 协议层测试
// 覆盖: sendJsonRpc(写入帧/往返/错误响应/超时清理/不可写清理)、
//       sendNotification(写/静默跳过)、handleJsonRpcMessage(无效JSON/
//       未知id/错误响应分派)、callToolInternal(空结果兜底/超大响应截断)、
//       requestListTools(SSE分派/字段映射默认值) — R1-2/B3 回归锚点
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@shared/types'
import {
  callToolInternal,
  handleJsonRpcMessage,
  requestListTools,
  sendJsonRpc,
  sendNotification,
} from '../../src/main/services/mcp/protocol'
import { CALL_TIMEOUT_MS, type MCPClient } from '../../src/main/services/mcp/types'

function makeClient(overrides: Partial<MCPClient> = {}): MCPClient {
  return {
    serverId: 'srv',
    config: { id: 'srv', name: 'srv', transport: 'stdio', command: 'echo' } as McpServerConfig,
    connected: true,
    tools: [],
    requestId: 0,
    pending: new Map(),
    ...overrides,
  }
}

function makeStdioClient(): { client: MCPClient; written: string[] } {
  const written: string[] = []
  const client = makeClient({
    childProcess: {
      stdin: { writable: true, write: (chunk: string) => written.push(chunk) },
    } as unknown as ChildProcess,
  })
  return { client, written }
}

describe('sendJsonRpc', () => {
  it('写入带换行的 JSON-RPC 帧,登记 pending,分配自增 id', () => {
    const { client, written } = makeStdioClient()
    const p = sendJsonRpc(client, 'tools/list', {})
    expect(written).toHaveLength(1)
    const frame = JSON.parse(written[0])
    expect(frame).toMatchObject({ jsonrpc: '2.0', id: 0, method: 'tools/list' })
    expect(client.requestId).toBe(1)
    expect(client.pending.has(0)).toBe(true)
    // 清理: 直接落响应避免悬挂
    handleJsonRpcMessage(client, JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} }))
    return p
  })

  it('匹配 id 的响应 resolve 且清理 pending', async () => {
    const { client } = makeStdioClient()
    const p = sendJsonRpc(client, 'tools/list', {})
    handleJsonRpcMessage(client, JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ok: 1 } }))
    await expect(p).resolves.toEqual({ ok: 1 })
    expect(client.pending.size).toBe(0)
  })

  it('error 响应 reject 并透出 message', async () => {
    const { client } = makeStdioClient()
    const p = sendJsonRpc(client, 'tools/list', {})
    handleJsonRpcMessage(
      client,
      JSON.stringify({ jsonrpc: '2.0', id: 0, error: { message: 'boom' } }),
    )
    await expect(p).rejects.toThrow('boom')
    expect(client.pending.size).toBe(0)
  })

  it('传输不可写: 立即 reject 且 pending/定时器均清理', async () => {
    const client = makeClient()
    await expect(sendJsonRpc(client, 'tools/list', {})).rejects.toThrow('not writable')
    expect(client.pending.size).toBe(0)
  })

  it('超时: reject 超时错误并从 pending 摘除(无泄漏)', async () => {
    vi.useFakeTimers()
    try {
      const { client } = makeStdioClient()
      const p = sendJsonRpc(client, 'tools/call', {})
      const assertion = expect(p).rejects.toThrow(`Request tools/call timeout after ${CALL_TIMEOUT_MS}ms`)
      await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 1)
      await assertion
      expect(client.pending.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sendNotification', () => {
  it('发送无 id 的通知帧', () => {
    const { client, written } = makeStdioClient()
    sendNotification(client, 'initialized', {})
    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0])).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} })
  })

  it('传输不可写时静默跳过(通知无响应语义)', () => {
    const client = makeClient()
    expect(() => sendNotification(client, 'initialized', {})).not.toThrow()
  })
})

describe('handleJsonRpcMessage', () => {
  it('无效 JSON 警告且不抛出', () => {
    const { client } = makeStdioClient()
    expect(() => handleJsonRpcMessage(client, '{not-json')).not.toThrow()
  })

  it('未知 id 的响应被忽略', () => {
    const { client } = makeStdioClient()
    expect(() =>
      handleJsonRpcMessage(client, JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} })),
    ).not.toThrow()
    expect(client.pending.size).toBe(0)
  })
})

describe('callToolInternal', () => {
  it('正常透传工具结果', async () => {
    const { client } = makeStdioClient()
    const p = callToolInternal(client, 'search', { q: 'x' })
    handleJsonRpcMessage(
      client,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: { content: [{ type: 'text', text: 'found' }] },
      }),
    )
    await expect(p).resolves.toEqual({ content: [{ type: 'text', text: 'found' }] })
  })

  it('空结果兜底为占位文本', async () => {
    const { client } = makeStdioClient()
    const p = callToolInternal(client, 'search', {})
    handleJsonRpcMessage(client, JSON.stringify({ jsonrpc: '2.0', id: 0, result: null }))
    await expect(p).resolves.toEqual({ content: [{ type: 'text', text: '(empty result)' }] })
  })

  it('超过 MAX_RESPONSE_SIZE 的结果截断为 isError 提示', async () => {
    const { client } = makeStdioClient()
    const p = callToolInternal(client, 'search', {})
    handleJsonRpcMessage(
      client,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: { content: [{ type: 'text', text: 'x'.repeat(5 * 1024 * 1024 + 64) }] },
      }),
    )
    const res = await p
    expect(res.isError).toBe(true)
    expect(res.content[0]?.type).toBe('text')
    expect(String(res.content[0]?.text)).toContain('响应过大')
  })
})

describe('requestListTools', () => {
  it('SSE 传输走 HTTP POST 通道(R1-2/B3 回归)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { tools: [{ name: 't1' }] } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = makeClient({
        serverId: 'sse1',
        config: {
          id: 'sse1',
          name: 'sse1',
          transport: 'sse',
          url: 'http://localhost:8080/mcp',
        } as unknown as McpServerConfig,
      })
      const tools = await requestListTools(client)
      expect(tools).toEqual([
        { serverId: 'sse1', name: 't1', description: '', inputSchema: {} },
      ])
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('POST')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stdio 传输的 tools 响应做字段映射默认值兜底', async () => {
    const { client } = makeStdioClient()
    const p = requestListTools(client)
    handleJsonRpcMessage(
      client,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: { tools: [{ name: 't2', description: 'd2' }] },
      }),
    )
    const tools = await p
    expect(tools).toEqual([
      { serverId: 'srv', name: 't2', description: 'd2', inputSchema: {} },
    ])
  })
})
