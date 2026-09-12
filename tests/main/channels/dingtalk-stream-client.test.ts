// =============================================================
// 钉钉 Stream Mode 客户端 — 协议行为锚定(假 WS + 假 fetch):
//   connections/open 请求形状 / ping-pong(opaque 回传) /
//   CALLBACK 立即 ACK / disconnect 主动重连 / 守护退避与放弃
// =============================================================

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

import {
  DingtalkStreamClient,
  type WsLike,
} from '../../../src/main/services/channels/adapters/dingtalk/stream-client'

/** 假 WebSocket: 记录发送帧,支持手动注入下行帧/事件 */
class FakeWs extends EventEmitter implements WsLike {
  sent: string[] = []
  pinged = 0
  closed = false
  constructor(public url: string) {
    super()
  }
  send(data: string): void {
    this.sent.push(data)
  }
  ping(): void {
    this.pinged++
  }
  close(): void {
    this.closed = true
    this.emit('close', 1000, Buffer.from(''))
  }
  off(event: string, fn: (...args: unknown[]) => void): this {
    return super.off(event, fn as never)
  }
  removeAllListeners(event?: string): this {
    return super.removeAllListeners(event)
  }
  /** 注入一条下行帧 */
  feed(frame: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(frame)))
  }
}

/** 假 fetch: 记录请求;按配置返回 connections/open 响应 */
function makeFetch(records: Array<{ url: string; body: unknown }>) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    records.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (String(url).endsWith('/v1.0/gateway/connections/open')) {
      return jsonResponse({ endpoint: 'wss://gw.test/connect', ticket: `ticket-${records.length}` })
    }
    return jsonResponse({})
  }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('DingtalkStreamClient', () => {
  let sockets: FakeWs[]
  let records: Array<{ url: string; body: unknown }>
  let onMessage: ReturnType<typeof vi.fn>
  let client: DingtalkStreamClient

  beforeEach(() => {
    vi.useFakeTimers()
    sockets = []
    records = []
    onMessage = vi.fn()
    client = new DingtalkStreamClient({
      clientId: 'cid',
      clientSecret: 'csecret',
      onMessage,
      fetchImpl: makeFetch(records),
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        sockets.push(ws)
        // 微任务触发 open(假定时器下 setTimeout 永不触发,connect 会死等)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
  })

  afterEach(() => {
    client.stop()
    vi.useRealTimers()
  })

  it('connect(): connections/open 请求形状正确(订阅机器人 topic)', async () => {
    await client.connect()
    expect(records).toHaveLength(1)
    expect(records[0].url).toContain('/v1.0/gateway/connections/open')
    expect(records[0].body).toMatchObject({
      clientId: 'cid',
      clientSecret: 'csecret',
      subscriptions: [{ type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' }],
    })
    // 握手 URL = endpoint?ticket=…
    expect(sockets[0]?.url).toContain('wss://gw.test/connect?ticket=')
  })

  it('SYSTEM ping → 回传同 messageId 的 pong(opaque 原样)', async () => {
    await client.connect()
    sockets[0].feed({
      type: 'SYSTEM',
      headers: { topic: 'ping', messageId: 'ping-1' },
      data: '{"opaque":"abc-123"}',
    })
    expect(sockets[0].sent).toHaveLength(1)
    const pong = JSON.parse(sockets[0].sent[0])
    expect(pong).toMatchObject({ code: 200, headers: { messageId: 'ping-1' } })
    expect(pong.data).toBe('{"opaque":"abc-123"}')
  })

  it('CALLBACK → 立即 ACK(messageId 同值) + onMessage 收到 data', async () => {
    await client.connect()
    sockets[0].feed({
      type: 'CALLBACK',
      headers: { topic: '/v1.0/im/bot/messages/get', messageId: 'm-9' },
      data: '{"msgId":"biz-1","text":{"content":"hi"}}',
    })
    expect(onMessage).toHaveBeenCalledWith('{"msgId":"biz-1","text":{"content":"hi"}}', 'm-9')
    const ack = JSON.parse(sockets[0].sent[0])
    expect(ack).toMatchObject({
      code: 200,
      headers: { messageId: 'm-9', contentType: 'application/json' },
      data: '{"response":null}',
    })
  })

  it('disconnect 通知 → 主动断开并立即重连(新 ticket)', async () => {
    await client.connect()
    expect(sockets).toHaveLength(1)
    sockets[0].feed({
      type: 'SYSTEM',
      headers: { topic: 'disconnect', messageId: 'd-1' },
      data: '{"reason":"connection is expired"}',
    })
    await vi.advanceTimersByTimeAsync(50)
    // 重连: 第二次 connections/open + 第二个 WS 实例
    expect(records).toHaveLength(2)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)
  })

  it('WS 意外断开 → 指数退避重连;成功后归零', async () => {
    await client.connect()
    sockets[0].emit('close', 1006, Buffer.from(''))
    // 首次退避 5s(2^0 * 5000)
    await vi.advanceTimersByTimeAsync(5100)
    expect(sockets).toHaveLength(2)
  })

  it('连接后连续断连且重连失败 → 达上限后 error 且不再自动重连', async () => {
    // 第 1 个 socket 建连成功;之后的 socket 全部握手失败
    let socketIndex = 0
    client = new DingtalkStreamClient({
      clientId: 'cid',
      clientSecret: 'csecret',
      onMessage,
      fetchImpl: makeFetch(records),
      wsFactory: () => {
        const ws = new FakeWs('wss://gw.test/connect')
        sockets.push(ws)
        if (socketIndex++ === 0) queueMicrotask(() => ws.emit('open'))
        else queueMicrotask(() => ws.emit('error', new Error('boom')))
        return ws
      },
    })
    const statuses: Array<[string, string?]> = []
    client.on('status', (s: string, detail?: string) => statuses.push([s, detail]))
    await client.connect()
    expect(statuses[statuses.length - 1]?.[0]).toBe('connected')

    // 已建立连接断开 → 守护重连(退避 5s,10s,20s,40s,60s,60s,60s,60s,共 8 次)
    sockets[0].emit('close', 1006, Buffer.from(''))
    await vi.advanceTimersByTimeAsync(400_000)
    const lastStatus = statuses[statuses.length - 1]
    expect(lastStatus?.[0]).toBe('error')
    expect(lastStatus?.[1]).toMatch(/多次失败/)
    const socketCount = sockets.length
    // 放弃后不再自动重连
    await vi.advanceTimersByTimeAsync(200_000)
    expect(sockets.length).toBe(socketCount)
    // 再次 connect() 复位守护并允许重试
    client.stop()
  })

  it('stop(): 关闭 socket、清空保活定时器', async () => {
    await client.connect()
    const ws = sockets[0]
    vi.advanceTimersByTime(30_000)
    expect(ws.pinged).toBeGreaterThan(0)
    client.stop()
    expect(ws.closed).toBe(true)
  })
})
