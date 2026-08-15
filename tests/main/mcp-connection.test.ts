// =============================================================
// MCP connection — 单连接生命周期测试
// 覆盖: connectTransport(transport 分发/SSRF/超时)、stdio(spawn/按行解析/
//       握手/错误)、sse(fetch 分支)、websocket(ws 分支)、disconnectClient 清理
// =============================================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { McpServerConfig } from '@shared/types'
import type { MCPClient } from '../../src/main/services/mcp-types'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  sendJsonRpc: vi.fn(),
  sendNotification: vi.fn(),
  handleJsonRpcMessage: vi.fn(),
}))

// ws mock 的实例记录(顶层注册,避免测试内 vi.mock 提升问题)
const wsState = vi.hoisted(() => ({ instances: [] as Array<Record<string, unknown>> }))

class FakeWebSocket {
  url: string
  handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  constructor(url: string) {
    this.url = url
    wsState.instances.push(this as unknown as Record<string, unknown>)
  }
  on(ev: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(ev) ?? []
    list.push(cb)
    this.handlers.set(ev, list)
  }
  emit(ev: string, ...args: unknown[]) {
    for (const cb of this.handlers.get(ev) ?? []) cb(...args)
  }
  close() {
    this.emit('close')
  }
}

vi.mock('ws', () => ({ default: FakeWebSocket }))

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}))

vi.mock('../../src/main/services/mcp/protocol', () => ({
  sendJsonRpc: mocks.sendJsonRpc,
  sendNotification: mocks.sendNotification,
  handleJsonRpcMessage: mocks.handleJsonRpcMessage,
}))

vi.mock('../../src/main/services/mcp/spawn-env', () => ({
  buildSpawnEnv: (env?: Record<string, string>) => ({ PATH: 'mock-path', ...env }),
  resolveSpawnCommand: (cmd: string) => cmd,
}))

const { connectTransport, disconnectClient } = await import(
  '../../src/main/services/mcp/connection'
)

/** 构造最小 MCPClient */
function makeClient(): MCPClient {
  return {
    serverId: 'srv1',
    config: {} as McpServerConfig,
    connected: false,
    tools: [],
    requestId: 1,
    pending: new Map(),
  }
}

/** 构造 stdio server 配置 */
function stdioServer(p: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv1',
    name: 'S1',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server'],
    ...p,
  }
}

interface FakeChild {
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  killed: boolean
  stdout: { on: ReturnType<typeof vi.fn> }
  stderr: { on: ReturnType<typeof vi.fn> }
}

function fakeChild(): FakeChild {
  return {
    on: vi.fn(),
    once: vi.fn(),
    kill: vi.fn(),
    killed: false,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }
}

/** 取出 child.on(event) 注册的回调 */
function handlerOf(target: { on: ReturnType<typeof vi.fn> }, event: string) {
  const call = target.on.mock.calls.find(([ev]) => ev === event)
  return call?.[1] as (...args: unknown[]) => void
}

/** flush 微任务 */
async function flush(rounds = 5) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
describe('connectTransport — transport 分发与 SSRF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendJsonRpc.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('不支持的 transport 直接拒绝', async () => {
    const client = makeClient()
    await expect(
      connectTransport(client, stdioServer({ transport: 'bogus' as McpServerConfig['transport'] })),
    ).rejects.toThrow(/Unsupported transport: bogus/)
    expect(client.connected).toBe(false)
  })

  it('sse 内网 URL 被 SSRF 防护拒绝', async () => {
    const client = makeClient()
    await expect(
      connectTransport(client, stdioServer({ transport: 'sse', url: 'http://192.168.1.10/sse' })),
    ).rejects.toThrow(/SSRF protection/)
  })

  it('websocket 云元数据地址被 SSRF 防护拒绝', async () => {
    const client = makeClient()
    await expect(
      connectTransport(
        client,
        stdioServer({ transport: 'websocket', url: 'http://169.254.169.254/ws' }),
      ),
    ).rejects.toThrow(/SSRF protection/)
  })

  it('公网 https URL 通过 SSRF 检查(进入 sse 连接)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = makeClient()
      await connectTransport(
        client,
        stdioServer({ transport: 'sse', url: 'https://mcp.example.com/sse' }),
      )
      expect(client.connected).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mcp.example.com/sse',
        expect.objectContaining({ method: 'POST' }),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('connectTransport — stdio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendJsonRpc.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('缺少 command 时拒绝且不 spawn', async () => {
    const client = makeClient()
    const server = stdioServer()
    delete (server as Partial<McpServerConfig>).command
    await expect(connectTransport(client, server)).rejects.toThrow(/missing command/)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('成功握手: spawn 参数正确 + initialize + initialized + connected', async () => {
    const child = fakeChild()
    mocks.spawn.mockReturnValue(child)
    const client = makeClient()
    const server = stdioServer({ env: { FOO: 'bar' } })

    await connectTransport(client, server)

    expect(mocks.spawn).toHaveBeenCalledWith('npx', ['-y', 'server'], {
      env: { PATH: 'mock-path', FOO: 'bar' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    expect(client.childProcess).toBe(child)
    expect(client.connected).toBe(true)
    expect(mocks.sendJsonRpc).toHaveBeenCalledWith(
      client,
      'initialize',
      expect.objectContaining({ protocolVersion: '2024-11-05' }),
    )
    expect(mocks.sendNotification).toHaveBeenCalledWith(client, 'notifications/initialized', {})
  })

  it('initialize 失败: 拒绝且 connected 保持 false', async () => {
    mocks.spawn.mockReturnValue(fakeChild())
    mocks.sendJsonRpc.mockRejectedValue(new Error('handshake failed'))
    const client = makeClient()

    await expect(connectTransport(client, stdioServer())).rejects.toThrow('handshake failed')
    expect(client.connected).toBe(false)
  })

  it('spawn error 事件: 记录 lastError 并拒绝', async () => {
    const child = fakeChild()
    mocks.spawn.mockReturnValue(child)
    mocks.sendJsonRpc.mockReturnValue(new Promise(() => {})) // 挂起等待 error
    const client = makeClient()

    const p = connectTransport(client, stdioServer())
    const errHandler = handlerOf(child, 'error')
    errHandler(new Error('ENOENT'))

    await expect(p).rejects.toThrow('ENOENT')
    expect(client.lastError).toBe('spawn error: ENOENT')
  })

  it('子进程连接前退出: 拒绝并提示 exited before connect', async () => {
    const child = fakeChild()
    mocks.spawn.mockReturnValue(child)
    mocks.sendJsonRpc.mockReturnValue(new Promise(() => {}))
    const client = makeClient()

    const p = connectTransport(client, stdioServer())
    handlerOf(child, 'exit')(1, 'SIGTERM')

    await expect(p).rejects.toThrow(/exited before connect \(code=1, signal=SIGTERM\)/)
    expect(client.connected).toBe(false)
  })

  it('stdout 按行解析 JSON-RPC,不完整行留在缓冲区', async () => {
    const child = fakeChild()
    mocks.spawn.mockReturnValue(child)
    const client = makeClient()

    await connectTransport(client, stdioServer())
    const dataHandler = handlerOf(child.stdout, 'data') as (chunk: Buffer) => void

    dataHandler(Buffer.from('{"jsonrpc":"2.0","id":1}\n{"partial":'))
    expect(mocks.handleJsonRpcMessage).toHaveBeenCalledTimes(1)
    expect(mocks.handleJsonRpcMessage).toHaveBeenCalledWith(client, '{"jsonrpc":"2.0","id":1}')
    expect(client.buffer).toBe('{"partial":')

    dataHandler(Buffer.from('true}\n'))
    expect(mocks.handleJsonRpcMessage).toHaveBeenCalledTimes(2)
    expect(client.buffer).toBe('')
  })

  it('连接超时: 30s 后拒绝并提示 Connect timeout', async () => {
    vi.useFakeTimers()
    try {
      mocks.spawn.mockReturnValue(fakeChild())
      mocks.sendJsonRpc.mockReturnValue(new Promise(() => {})) // 永不返回
      const client = makeClient()

      const p = connectTransport(client, stdioServer())
      const assertion = expect(p).rejects.toThrow(/Connect timeout after 30000ms/)
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(client.connected).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
describe('connectTransport — sse (fetch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendJsonRpc.mockResolvedValue({})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('缺少 url 时被 SSRF 断言拒绝(url 显示 (missing))', async () => {
    const client = makeClient()
    const server = stdioServer({ transport: 'sse' })
    delete (server as Partial<McpServerConfig>).url
    // connectTransport 在分发前先做 SSRF 断言,undefined url 在此即被拒绝
    await expect(connectTransport(client, server)).rejects.toThrow(
      /url refused \(SSRF protection\): \(missing\)/,
    )
  })

  it('HTTP 非 2xx 响应: 拒绝并带状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }),
    )
    const client = makeClient()

    await expect(
      connectTransport(client, stdioServer({ transport: 'sse', url: 'https://ok.example.com/s' })),
    ).rejects.toThrow(/responded 500: Server Error/)
    expect(client.connected).toBe(false)
  })

  it('成功: 发送 initialize POST 且带自定义 headers,清空 lastError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient()
    client.lastError = 'stale error'

    await connectTransport(
      client,
      stdioServer({
        transport: 'sse',
        url: 'https://ok.example.com/sse',
        headers: { Authorization: 'Bearer tok' },
      }),
    )

    expect(client.connected).toBe(true)
    expect(client.lastError).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ok.example.com/sse')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    })
    const body = JSON.parse(init.body as string) as { method: string; id: number }
    expect(body.method).toBe('initialize')
    expect(body.id).toBe(1)
  })
})

describe('connectTransport — websocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendJsonRpc.mockResolvedValue({})
  })

  it('缺少 url 时被 SSRF 断言拒绝', async () => {
    const client = makeClient()
    const server = stdioServer({ transport: 'websocket' })
    delete (server as Partial<McpServerConfig>).url
    await expect(connectTransport(client, server)).rejects.toThrow(
      /url refused \(SSRF protection\): \(missing\)/,
    )
  })

  it('open 后完成握手并置 connected', async () => {
    const client = makeClient()
    const before = wsState.instances.length

    const p = connectTransport(
      client,
      stdioServer({ transport: 'websocket', url: 'wss://mcp.example.com/ws' }),
    )
    // 动态 import('ws') 是真实的模块加载,用 waitFor 等实例构造完成
    await vi.waitFor(() => {
      expect(wsState.instances.length).toBe(before + 1)
    })
    const ws = wsState.instances.at(-1) as unknown as FakeWebSocket
    expect(ws.url).toBe('wss://mcp.example.com/ws')

    ws.emit('open')
    await p

    expect(client.connected).toBe(true)
    expect(mocks.sendJsonRpc).toHaveBeenCalledWith(
      client,
      'initialize',
      expect.objectContaining({ protocolVersion: '2024-11-05' }),
    )
    expect(mocks.sendNotification).toHaveBeenCalledWith(client, 'notifications/initialized', {})
  })

  it('连接前 ws error: 拒绝并记录 lastError', async () => {
    const client = makeClient()
    const before = wsState.instances.length

    const p = connectTransport(
      client,
      stdioServer({ transport: 'websocket', url: 'wss://mcp.example.com/ws' }),
    )
    await vi.waitFor(() => {
      expect(wsState.instances.length).toBe(before + 1)
    })
    const ws = wsState.instances.at(-1) as unknown as FakeWebSocket

    ws.emit('error', new Error('upgrade failed'))
    await expect(p).rejects.toThrow('upgrade failed')
    expect(client.connected).toBe(false)
    expect(client.lastError).toBe('ws error: upgrade failed')
    expect(before + 1).toBe(wsState.instances.length)
  })
})

describe('disconnectClient', () => {
  it('清理 pending/子进程/websocket 并复位 connected', async () => {
    const client = makeClient()
    client.connected = true
    const entry = {
      resolve: vi.fn(),
      reject: vi.fn(),
      timer: setTimeout(() => {}, 100_000),
    }
    client.pending.set(1, entry)
    const child = fakeChild()
    client.childProcess = child as never
    const wsClose = vi.fn()
    client.ws = { close: wsClose } as never

    await disconnectClient(client)

    expect(client.connected).toBe(false)
    expect(entry.reject.mock.calls[0][0].message).toBe('Client disconnected')
    expect(client.pending.size).toBe(0)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(client.childProcess).toBeUndefined()
    expect(wsClose).toHaveBeenCalledTimes(1)
    expect(client.ws).toBeUndefined()
  })

  it('kill 抛错时静默忽略,仍继续清理 ws', async () => {
    const client = makeClient()
    const child = fakeChild()
    child.kill.mockImplementation(() => {
      throw new Error('already dead')
    })
    client.childProcess = child as never
    const wsClose = vi.fn()
    client.ws = { close: wsClose } as never

    await expect(disconnectClient(client)).resolves.toBeUndefined()
    expect(client.childProcess).toBeUndefined()
    expect(wsClose).toHaveBeenCalledTimes(1)
  })

  it('无子进程/websocket 时仅清理 pending', async () => {
    const client = makeClient()
    client.connected = true
    const entry = { resolve: vi.fn(), reject: vi.fn(), timer: setTimeout(() => {}, 1000) }
    client.pending.set(7, entry)

    await disconnectClient(client)
    expect(client.pending.size).toBe(0)
    expect(entry.reject).toHaveBeenCalledTimes(1)
  })
})