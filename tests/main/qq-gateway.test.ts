// =============================================================
// qq/gateway — WebSocket 网关协议客户端测试
// 假 token 模块 + 可注入 FakeWs + 假定时器,锁定协议语义:
// IDENTIFY/RESUME 分叉、心跳带 lastSeq、READY/RESUMED 状态、
// 断线指数退避、INVALID_SESSION 降级、RECONNECT 立即重连、
// stop 终态与垃圾帧吞错。
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as C from '../../src/main/services/channels/adapters/qq/constants'
import { QqGatewayClient } from '../../src/main/services/channels/adapters/qq/gateway'
import type { WsLike } from '../../src/main/services/channels/adapters/qq/gateway'

const mocks = vi.hoisted(() => ({
  fetchQqAccessToken: vi.fn(),
  fetchQqGatewayUrl: vi.fn(),
}))

vi.mock('../../src/main/services/channels/adapters/qq/token', () => ({
  fetchQqAccessToken: mocks.fetchQqAccessToken,
  fetchQqGatewayUrl: mocks.fetchQqGatewayUrl,
}))

type Handler = (...args: unknown[]) => void

class FakeWs implements WsLike {
  handlers = new Map<string, Handler[]>()
  sent: string[] = []
  readyState = 1
  closed = false
  constructor(public url: string) {}
  on(event: string, fn: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
    return this
  }
  off(event: string, fn: Handler): this {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((f) => f !== fn))
    return this
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
    this.readyState = 3
    this.trigger('close', 1000, Buffer.from(''))
  }
  trigger(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args)
  }
  lastSent(): { op?: number; d?: unknown } {
    return JSON.parse(this.sent[this.sent.length - 1] ?? '{}')
  }
}

const sockets: FakeWs[] = []
const onDispatch = vi.fn()

function makeClient(): QqGatewayClient {
  sockets.length = 0
  return new QqGatewayClient({
    appId: '10086',
    clientSecret: 's',
    wsFactory: (u) => {
      const ws = new FakeWs(u)
      sockets.push(ws)
      return ws
    },
    onDispatch,
  })
}

function frame(op: number, d: unknown, s?: number, t?: string): string {
  return JSON.stringify({ op, d, s, t })
}

/** 刷空微任务队列(token→url 两次异步后才建 ws) */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** 连接 → HELLO → IDENTIFY → READY 的标准通路 */
async function connectReady(client: QqGatewayClient): Promise<void> {
  const p = client.connect()
  await flushMicrotasks()
  sockets[0].trigger('open')
  await p
  sockets[0].trigger('message', frame(C.QQ_OP_HELLO, { heartbeat_interval: 50 }))
  sockets[0].trigger(
    'message',
    frame(C.QQ_OP_DISPATCH, { session_id: 'sess-1' }, 5, 'READY'),
  )
}

describe('QqGatewayClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.fetchQqAccessToken.mockResolvedValue({ accessToken: 'tok' })
    mocks.fetchQqGatewayUrl.mockResolvedValue('wss://gw')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('连接全链: IDENTIFY 带 token/intents/shard,READY 后 connected 且透传 dispatch', async () => {
    const client = makeClient()
    const statuses: Array<[string, unknown]> = []
    client.on('status', (s: string, detail?: unknown) => statuses.push([s, detail]))
    await connectReady(client)

    expect(sockets[0].url).toBe('wss://gw')
    const identify = sockets[0].lastSent()
    expect(identify.op).toBe(C.QQ_OP_IDENTIFY)
    expect(identify.d).toEqual({
      token: 'QQBot tok',
      intents: C.QQ_INTENT_GROUP_AND_C2C | C.QQ_INTENT_PUBLIC_GUILD_MESSAGES | C.QQ_INTENT_DIRECT_MESSAGE,
      shard: [0, 1],
    })
    expect(statuses.at(-1)).toEqual(['connected', undefined])

    sockets[0].trigger('message', frame(C.QQ_OP_DISPATCH, { id: 'm1' }, 6, 'C2C_MESSAGE_CREATE'))
    expect(onDispatch).toHaveBeenCalledWith('C2C_MESSAGE_CREATE', { id: 'm1' })
  })

  it('心跳: HELLO 间隔触发,携带最新 lastSeq', async () => {
    const client = makeClient()
    await connectReady(client)
    sockets[0].trigger('message', frame(C.QQ_OP_DISPATCH, { id: 'm2' }, 9, 'GROUP_AT_MESSAGE_CREATE'))
    await vi.advanceTimersByTimeAsync(105)
    const hb = sockets[0].lastSent()
    expect(hb.op).toBe(C.QQ_OP_HEARTBEAT)
    expect(hb.d).toBe(9)
    client.stop()
  })

  it('断线重连: 指数退避表取值并递增;重连成功清零', async () => {
    const client = makeClient()
    await connectReady(client)
    const recons: Array<[number, number]> = []
    client.on('reconnect', (n: number, d: number) => recons.push([n, d]))

    sockets[0].trigger('close', 1000, Buffer.from(''))
    expect(recons[0]).toEqual([1, C.QQ_RECONNECT_DELAYS_MS[0]])
    await vi.advanceTimersByTimeAsync(C.QQ_RECONNECT_DELAYS_MS[0] + 5)
    await flushMicrotasks()
    expect(sockets).toHaveLength(2)
    sockets[1].trigger('open')
    await flushMicrotasks()

    sockets[1].trigger('close', 1000, Buffer.from(''))
    expect(recons[1]).toEqual([2, C.QQ_RECONNECT_DELAYS_MS[1]])
    client.stop()
  })

  it('RESUME: 有 session+seq 时重连发 RESUME;RESUMED 同样 connected', async () => {
    const client = makeClient()
    await connectReady(client)
    sockets[0].trigger('close', 1000, Buffer.from(''))
    await vi.advanceTimersByTimeAsync(C.QQ_RECONNECT_DELAYS_MS[0] + 5)

    sockets[1].trigger('open')
    await flushMicrotasks()
    sockets[1].trigger('message', frame(C.QQ_OP_HELLO, { heartbeat_interval: 50 }))
    const resume = sockets[1].lastSent()
    expect(resume.op).toBe(C.QQ_OP_RESUME)
    expect(resume.d).toEqual({ token: 'QQBot tok', session_id: 'sess-1', seq: 5 })

    sockets[1].trigger('message', frame(C.QQ_OP_DISPATCH, {}, 6, 'RESUMED'))
    expect(client.getReconnectAttempt()).toBe(0)
    client.stop()
  })

  it('INVALID_SESSION 不可恢复: 清 session 后降级为重新 IDENTIFY', async () => {
    const client = makeClient()
    await connectReady(client)
    sockets[0].trigger('message', frame(C.QQ_OP_INVALID_SESSION, false))
    expect(sockets[0].closed).toBe(true)

    await vi.advanceTimersByTimeAsync(C.QQ_RECONNECT_DELAYS_MS[0] + 5)
    sockets[1].trigger('open')
    await flushMicrotasks()
    sockets[1].trigger('message', frame(C.QQ_OP_HELLO, { heartbeat_interval: 50 }))
    expect(sockets[1].lastSent().op).toBe(C.QQ_OP_IDENTIFY)
    client.stop()
  })

  it('RECONNECT op: 立即关 ws 走重连;垃圾 JSON 帧吞错', async () => {
    const client = makeClient()
    await connectReady(client)
    sockets[0].trigger('message', 'not-json{{{')
    sockets[0].trigger('message', frame(C.QQ_OP_RECONNECT, null))
    expect(sockets[0].closed).toBe(true)
    client.stop()
  })

  it('stop: 终态,关 ws 清定时器,其后 close 不再重连', async () => {
    const client = makeClient()
    await connectReady(client)
    client.stop()
    expect(sockets[0].closed).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
    expect(mocks.fetchQqAccessToken).toHaveBeenCalledTimes(1)
  })
})