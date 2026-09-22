import { describe, expect, it } from 'vitest'

import {
  type EaaMcpProfile,
  type ExposedTool,
  MCP_SERVER_NAME_PATTERN,
  startEaaMcpServer,
} from '../eaa-mcp-server'

const calls: { id: string; params: unknown }[] = []

function makeTools(names: string[]): ExposedTool[] {
  return names.map((name) => ({
    name,
    description: `工具 ${name}`,
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
    execute: async (toolCallId: string, params: never) => {
      calls.push({ id: toolCallId, params })
      return { content: [{ type: 'text', text: `${name}:ok` }], details: { name } }
    },
  }))
}

const profiles: EaaMcpProfile[] = [
  { name: 'classes', tools: makeTools(['class_list', 'class_create']) },
  { name: 'grades', tools: makeTools(['grades_report']) },
]

const TOKENS = { classes: 'tok-classes', grades: 'tok-grades' }

interface Reply {
  status: number
  result?: unknown
  error?: { code: number; message: string }
}

function authHeader(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` }
}

async function rpc(url: string, token: string, body: unknown): Promise<Reply> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const merged: Reply = { status: res.status }
  if (text) Object.assign(merged, JSON.parse(text))
  return merged
}

async function listToolNames(
  endpoints: Record<string, { url: string; token: string }>,
  name: 'classes' | 'grades',
): Promise<string[]> {
  const reply = await rpc(endpoints[name].url, TOKENS[name], {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  })
  const listed = reply.result as { tools: { name: string }[] }
  return listed.tools.map((t) => t.name)
}

const start = (tokens?: Record<string, string>) => startEaaMcpServer({ profiles, port: 0, tokens })

describe('eaa MCP 服务端（按 profile 分端点）', () => {
  it('只绑 loopback，每个 profile 一个端点并带各自 token 与工具数', async () => {
    const server = await start()
    try {
      expect(Object.keys(server.endpoints)).toEqual(['classes', 'grades'])
      expect(server.endpoints.classes.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/classes$/)
      expect(server.endpoints.classes.toolCount).toBe(2)
      expect(server.endpoints.grades.toolCount).toBe(1)
      expect(server.endpoints.classes.token).not.toBe(server.endpoints.grades.token)
    } finally {
      await server.close()
    }
  })

  it('一个 profile 只暴露自己的工具（capability 隔离）', async () => {
    const server = await start(TOKENS)
    try {
      expect(await listToolNames(server.endpoints, 'classes')).toEqual([
        'class_list',
        'class_create',
      ])
      expect(await listToolNames(server.endpoints, 'grades')).toEqual(['grades_report'])
    } finally {
      await server.close()
    }
  })

  it('运行中 register 的端点立刻生效，unregister 后同路径 404', async () => {
    const server = await start(TOKENS)
    try {
      const ep = server.register({ name: 'ro', tools: makeTools(['query_score']) })
      expect(ep.url).toBe(`http://127.0.0.1:${server.port}/mcp/ro`)
      expect(ep.toolCount).toBe(1)
      expect(server.endpoints.ro).toBe(ep)

      const listed = await rpc(ep.url, ep.token, { jsonrpc: '2.0', id: 30, method: 'tools/list' })
      const names = (listed.result as { tools: { name: string }[] }).tools.map((t) => t.name)
      expect(names).toEqual(['query_score'])
      // 新端点看不到别人的工具
      const cross = await rpc(ep.url, ep.token, {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: { name: 'grades_report', arguments: {} },
      })
      expect(cross.error?.code).toBe(-32602)

      server.unregister('ro')
      expect(Object.keys(server.endpoints)).toEqual(['classes', 'grades'])
      const gone = await rpc(ep.url, ep.token, { jsonrpc: '2.0', id: 32, method: 'tools/list' })
      expect(gone.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('register 对名字的要求与启动时一致（非法/占用中的都拒）', async () => {
    const server = await start(TOKENS)
    try {
      expect(() => server.register({ name: 'bad name', tools: [] })).toThrow(/serverName 约束/)
      expect(() => server.register({ name: 'classes', tools: [] })).toThrow(/重复的 profile name/)
      // 撤掉后可以再用同名（新 token）
      server.unregister('classes')
      const again = server.register({ name: 'classes', tools: makeTools(['x']) })
      expect(again.token).not.toBe(TOKENS.classes)
    } finally {
      await server.close()
    }
  })

  it('A 端点的 token 不能调 B 端点（token 与端点绑定）', async () => {
    const server = await start(TOKENS)
    try {
      const cross = await rpc(server.endpoints.grades.url, TOKENS.classes, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      })
      expect(cross.status).toBe(401)
      expect(cross.error?.code).toBe(-32000)
    } finally {
      await server.close()
    }
  })

  it('未知端点 404；缺 profile 段的路径也 404', async () => {
    const server = await start(TOKENS)
    try {
      const unknown = await fetch(`http://127.0.0.1:${server.port}/mcp/nosuch`, {
        method: 'POST',
        headers: authHeader(TOKENS.classes),
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      })
      expect(unknown.status).toBe(404)

      const root = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        body: '{}',
      })
      expect(root.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('initialize 协商协议版本，serverInfo 带 profile 名', async () => {
    const server = await start(TOKENS)
    try {
      const ok = await rpc(server.endpoints.classes.url, TOKENS.classes, {
        jsonrpc: '2.0',
        id: 4,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      })
      const result = ok.result as {
        protocolVersion: string
        serverInfo: { name: string }
        capabilities: unknown
      }
      expect(result.protocolVersion).toBe('2024-11-05')
      expect(result.serverInfo.name).toBe('education-advisor-eaa/classes')
      expect(result.capabilities).toEqual({ tools: {} })

      const fallback = await rpc(server.endpoints.classes.url, TOKENS.classes, {
        jsonrpc: '2.0',
        id: 5,
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      })
      expect((fallback.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18')
    } finally {
      await server.close()
    }
  })

  it('tools/call 透传 callId 与 arguments，回 content/structuredContent', async () => {
    calls.length = 0
    const server = await start(TOKENS)
    try {
      const called = await rpc(server.endpoints.classes.url, TOKENS.classes, {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'class_list', arguments: { id: 'c1' } },
      })
      expect(calls).toEqual([{ id: '7', params: { id: 'c1' } }])
      expect(called.result).toEqual({
        content: [{ type: 'text', text: 'class_list:ok' }],
        isError: false,
        structuredContent: { name: 'class_list' },
      })
    } finally {
      await server.close()
    }
  })

  it('调用别的 profile 的工具得到 -32602', async () => {
    const server = await start(TOKENS)
    try {
      const cross = await rpc(server.endpoints.grades.url, TOKENS.grades, {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'class_create', arguments: {} },
      })
      expect(cross.error).toEqual({ code: -32602, message: 'unknown tool: class_create' })
    } finally {
      await server.close()
    }
  })

  it('工具抛错转成 isError 结果，协议层不报错', async () => {
    const server = await startEaaMcpServer({
      profiles: [
        {
          name: 'boom',
          tools: [
            {
              name: 'explode',
              description: '总是失败',
              parameters: { type: 'object' },
              execute: async () => {
                throw new Error('磁盘已满')
              },
            },
          ],
        },
      ],
      tokens: { boom: 't' },
      port: 0,
    })
    try {
      const reply = await rpc(server.endpoints.boom.url, 't', {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'explode', arguments: {} },
      })
      expect(reply.result).toEqual({
        content: [{ type: 'text', text: '磁盘已满' }],
        isError: true,
      })
    } finally {
      await server.close()
    }
  })

  it('details 不可序列化时只回 content，不产生协议错误', async () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    const server = await startEaaMcpServer({
      profiles: [
        {
          name: 'circ',
          tools: [
            {
              name: 'bad_details',
              description: 'details 循环引用',
              parameters: { type: 'object' },
              execute: async () => ({
                content: [{ type: 'text', text: 'ok' }],
                details: circular,
              }),
            },
          ],
        },
      ],
      tokens: { circ: 't' },
      port: 0,
    })
    try {
      const reply = await rpc(server.endpoints.circ.url, 't', {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'bad_details', arguments: {} },
      })
      const payload = reply.result as { isError: boolean; structuredContent?: unknown }
      expect(payload.isError).toBe(false)
      expect(payload.structuredContent).toBeUndefined()
    } finally {
      await server.close()
    }
  })

  it('通知 202 空体；非 POST 405；坏 JSON 400；批量只回有 id 的', async () => {
    const server = await start(TOKENS)
    try {
      const url = server.endpoints.classes.url
      const note = await fetch(url, {
        method: 'POST',
        headers: authHeader(TOKENS.classes),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      })
      expect(note.status).toBe(202)
      expect(await note.text()).toBe('')

      const get = await fetch(url, {
        method: 'GET',
        headers: authHeader(TOKENS.classes),
      })
      expect(get.status).toBe(405)
      expect(get.headers.get('allow')).toBe('POST')

      const bad = await fetch(url, {
        method: 'POST',
        headers: authHeader(TOKENS.classes),
        body: '{oops',
      })
      expect(bad.status).toBe(400)
      expect((await bad.json()).error.code).toBe(-32700)

      const res = await fetch(url, {
        method: 'POST',
        headers: authHeader(TOKENS.classes),
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 11, method: 'ping' },
          { jsonrpc: '2.0', method: 'notifications/cancelled' },
          { jsonrpc: '2.0', id: 12, method: 'tools/nope' },
        ]),
      })
      const replies = (await res.json()) as { id: number }[]
      expect(replies.map((r) => r.id)).toEqual([11, 12])
    } finally {
      await server.close()
    }
  })

  it('profile 名不合法或重复时拒绝启动', async () => {
    await expect(
      startEaaMcpServer({ profiles: [{ name: 'bad name', tools: [] }] }),
    ).rejects.toThrow(/serverName 约束/)
    await expect(
      startEaaMcpServer({
        profiles: [
          { name: 'x', tools: [] },
          { name: 'x', tools: [] },
        ],
      }),
    ).rejects.toThrow(/重复的 profile name/)
    expect(MCP_SERVER_NAME_PATTERN.test('eaa_tools-1')).toBe(true)
    expect(MCP_SERVER_NAME_PATTERN.test('带中文')).toBe(false)
  })

  it('token 等长比较：长度不符与内容不符都拒绝', async () => {
    const server = await start({ classes: 'a'.repeat(48), grades: 'b'.repeat(48) })
    try {
      const short = await rpc(server.endpoints.classes.url, 'a'.repeat(47), {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/list',
      })
      expect(short.status).toBe(401)
      const sameLenWrong = await rpc(server.endpoints.classes.url, 'b'.repeat(48), {
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/list',
      })
      expect(sameLenWrong.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('close 后端口不再接受连接', async () => {
    const server = await start(TOKENS)
    const url = server.endpoints.classes.url
    await server.close()
    await expect(
      rpc(url, TOKENS.classes, { jsonrpc: '2.0', id: 15, method: 'tools/list' }),
    ).rejects.toThrow()
  })
})
