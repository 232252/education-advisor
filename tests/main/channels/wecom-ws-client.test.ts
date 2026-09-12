// =============================================================
// 企微长连接客户端 — 协议行为锚定(假 WS):
//   订阅帧形状/认证成功失败/心跳死线重连/disconnected_event 不重连/
//   守护退避与认证放弃/sendCommand 回复帧
// =============================================================

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

import type { WsLike } from '../../../src/main/services/channels/adapters/dingtalk/stream-client'
import { WecomWsClient } from '../../../src/main/services/channels/adapters/wecom/ws-client'

/**
 * 假 WebSocket: 记录上行帧,自动应答订阅/心跳(应答 errcode 可配),
 * 支持手动注入下行帧与事件。
 */
class FakeWs extends EventEmitter implements WsLike {
  sent: string[] = []
  closed = false
  /** 本 socket 的认证应答 errcode(0 = 成功) */
  authErrcode = 0
  /** 心跳自动应答开关 */
  autoPong = true
  constructor(public url: string) {
    super()
  }
  send(data: string): void {
    this.sent.push(data)
    const frame = JSON.parse(data) as { cmd?: string; headers?: { req_id?: string } }
    if (frame.cmd === 'aibot_subscribe' || frame.cmd === 'ping') {
      const errcode = frame.cmd === 'aibot_subscribe' ? this.authErrcode : this.autoPong ? 0 : 1
      queueMicrotask(() => {
        this.emit(
          'message',
          Buffer.from(JSON.stringify({ headers: { req_id: frame.headers?.req_id }, errcode })),
        )
      })
    }
  }
  ping(): void {}
  close(): void {
    this.closed = true
    this.emit('close', 1000, Buffer.from('client-close'))
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

describe('WecomWsClient', () => {
  let sockets: FakeWs[]
  let onMessage: ReturnType<typeof vi.fn>
  let client: WecomWsClient

  beforeEach(() => {
    vi.useFakeTimers()
    sockets = []
    onMessage = vi.fn()
    client = new WecomWsClient({
      botId: 'bot-1',
      secret: 'ws-secret',
      onMessage,
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        sockets.push(ws)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
  })

  afterEach(() => {
    client.stop()
    vi.useRealTimers()
  })

  it('connect(): 订阅帧形状正确,认证成功 → connected', async () => {
    const statuses: string[] = []
    client.on('status', (s: string) => statuses.push(s))
    await client.connect()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toBe('wss://openws.work.weixin.qq.com')
    const sub = JSON.parse(sockets[0].sent[0])
    expect(sub).toMatchObject({
      cmd: 'aibot_subscribe',
      body: { bot_id: 'bot-1', secret: 'ws-secret' },
    })
    expect(sub.headers.req_id).toMatch(/^aibot_subscribe_/)
    expect(statuses).toContain('connecting')
    expect(statuses[statuses.length - 1]).toBe('connected')
  })

  it('认证失败(errcode≠0) → connect() 拒绝并给出可读错误', async () => {
    sockets.length = 0
    client = new WecomWsClient({
      botId: 'bot-1',
      secret: 'bad',
      onMessage,
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        ws.authErrcode = 40001
        sockets.push(ws)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
    await expect(client.connect()).rejects.toThrow(/认证失败.*40001/)
    expect(sockets[0].closed).toBe(true)
  })

  it('认证超时(10s 无响应) → connect() 拒绝', async () => {
    sockets.length = 0
    client = new WecomWsClient({
      botId: 'bot-1',
      secret: 's',
      onMessage,
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        sockets.push(ws)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
    const p = client.connect()
    // 覆盖 send: 记录订阅帧但不自动应答(服务端沉默)。
    // 先挂 rejection 断言再推进时钟,避免提前 reject 变 unhandled
    const expectation = expect(p).rejects.toThrow(/订阅超时/)
    sockets[0].send = (data: string) => {
      sockets[0].sent.push(data)
    }
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  })

  it('aibot_msg_callback 帧交给 onMessage;其他回执不外泄', async () => {
    await client.connect()
    sockets[0].feed({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'cb_1' },
      body: { msgid: 'm-1', msgtype: 'text', text: { content: 'hi' } },
    })
    expect(onMessage).toHaveBeenCalledTimes(1)
    // 回执/心跳帧不进 onMessage
    sockets[0].feed({ headers: { req_id: 'aibot_respond_msg_x' }, errcode: 0 })
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('心跳连续 2 次未确认 → 判死线并重连(新 socket 重新订阅)', async () => {
    await client.connect()
    sockets[0].autoPong = false // 模拟服务端不再回 pong
    // t=30s ping#1(missedPong=1) → t=60s ping#2(missedPong=2) →
    // t=90s 检查达上限判死线 → 退避 5s 后重连
    await vi.advanceTimersByTimeAsync(90_000)
    await vi.advanceTimersByTimeAsync(5_100)
    expect(sockets.length).toBe(2)
    // 新 socket 重新走订阅
    const sub2 = JSON.parse(sockets[1].sent[0])
    expect(sub2.cmd).toBe('aibot_subscribe')
  })

  it('disconnected_event(被新连接接管) → error 且不再自动重连', async () => {
    await client.connect()
    const statuses: Array<[string, string?]> = []
    client.on('status', (s: string, detail?: string) => statuses.push([s, detail]))
    sockets[0].feed({
      cmd: 'aibot_event_callback',
      headers: { req_id: 'ev_1' },
      body: { event: { eventtype: 'disconnected_event' } },
    })
    const last = statuses[statuses.length - 1]
    expect(last?.[0]).toBe('error')
    expect(last?.[1]).toMatch(/接管/)
    // 长时间推进不再产生新连接
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sockets.length).toBe(1)
  })

  it('意外断开 → 退避重连;重连后认证失败 3 次 → 放弃并报可读错误', async () => {
    await client.connect()
    expect(sockets).toHaveLength(1)
    // 后续 socket 认证全部失败
    const factoryUrls: string[] = []
    client.stop()
    sockets.length = 0
    factoryUrls.length = 0

    const c2 = new WecomWsClient({
      botId: 'bot-1',
      secret: 's',
      onMessage,
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        factoryUrls.push(url)
        // 第 1 个 socket 认证成功;重连后的全部失败
        ws.authErrcode = sockets.length === 0 ? 0 : 40001
        sockets.push(ws)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
    const statuses: Array<[string, string?]> = []
    c2.on('status', (s: string, detail?: string) => statuses.push([s, detail]))
    await c2.connect()
    expect(statuses[statuses.length - 1]?.[0]).toBe('connected')

    sockets[0].emit('close', 1006, Buffer.from('net down'))
    // 退避 5s→10s→20s 三次重连均认证失败 → 第 4 次调度时放弃
    await vi.advanceTimersByTimeAsync(60_000)
    const last = statuses[statuses.length - 1]
    expect(last?.[0]).toBe('error')
    expect(last?.[1]).toMatch(/认证连续失败|多次失败/)
    const countAfterGiveUp = sockets.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sockets.length).toBe(countAfterGiveUp)
    c2.stop()
  })

  it('sendCommand: 回复帧带 cmd/req_id/body(respond 透传 req_id)', async () => {
    await client.connect()
    client.sendCommand('aibot_respond_msg', 'cb_req_1', {
      msgtype: 'stream',
      stream: { id: 's1', finish: false, content: '正在思考…' },
    })
    const sent = sockets[0].sent.map((s) => JSON.parse(s))
    const reply = sent.find((f) => f.cmd === 'aibot_respond_msg')
    expect(reply).toMatchObject({
      cmd: 'aibot_respond_msg',
      headers: { req_id: 'cb_req_1' },
      body: { msgtype: 'stream', stream: { id: 's1', finish: false, content: '正在思考…' } },
    })
  })

  it('stop(): 关闭 socket 并清定时器(不再心跳)', async () => {
    await client.connect()
    client.stop()
    expect(sockets[0].closed).toBe(true)
    const sentBefore = sockets[0].sent.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets[0].sent.length).toBe(sentBefore)
    expect(sockets.length).toBe(1)
  })
})
