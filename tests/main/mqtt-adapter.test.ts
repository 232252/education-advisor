// =============================================================
// adapters/mqtt — MQTT 薄客户端适配器测试
// 假 mqtt 模块(捕获 connect opts/订阅/发布/end)+ 假定时器,
// 锁定: 配置防呆三字段、连接/错误/超时三态、入站归一化、
// disconnect 幂等、出站防呆与 push topic 覆盖。
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'mqtt'
import { createMqttAdapter } from '../../src/main/services/channels/adapters/mqtt/index'

const mocks = vi.hoisted(() => ({ connect: vi.fn() }))

vi.mock('mqtt', () => ({ connect: mocks.connect }))
// 预热 mock 模块缓存: connect() 内部的动态 import('mqtt') 命中缓存后
// 才能在微任务层完成解析(假定时器下不依赖真实事件循环回合)
vi.mock('../../src/main/utils/logger', () => ({ log: vi.fn() }))

type Handler = (...args: unknown[]) => void

class FakeMqttClient {
  handlers = new Map<string, Handler[]>()
  subscribed: string[] = []
  published: Array<[string, string]> = []
  ended = 0
  on(event: string, cb: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb])
  }
  subscribe(topic: string): void {
    this.subscribed.push(topic)
  }
  publish(topic: string, payload: string): void {
    this.published.push([topic, payload])
  }
  end(_force: boolean, _opts: Record<string, unknown>, cb?: () => void): void {
    this.ended += 1
    cb?.()
  }
  trigger(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args)
  }
}

function makeCtx(config: Record<string, unknown> = {}) {
  const onStatus = vi.fn()
  const onMessage = vi.fn()
  const ctx = {
    config,
    getSecret: vi.fn(async () => 'pw'),
    bridge: { onStatus, onMessage },
  }
  return { ctx, onStatus, onMessage }
}

const CFG = {
  host: 'broker.local',
  port: 1884,
  username: 'u1',
  subscribeTopic: 'in/t',
  publishTopic: 'out/t',
  tls: false,
}

describe('MqttChannelAdapter', () => {
  let client: FakeMqttClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new FakeMqttClient()
    mocks.connect.mockReturnValue(client)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 真实定时器下等动态 import('mqtt') 完成解析(真实 I/O 回合) */
  async function waitForConnectCalled(): Promise<void> {
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled(), { timeout: 5000 })
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  it('validateConfig: host/subscribeTopic/publishTopic 三字段防呆', async () => {
    const adapter = createMqttAdapter()
    const { ctx } = makeCtx({})
    await expect(adapter.validateConfig(ctx as never)).resolves.toEqual({
      ok: false,
      message: 'Broker 主机未填写',
      field: 'host',
    })
    await expect(adapter.validateConfig(makeCtx({ host: 'h' }).ctx as never)).resolves.toEqual({
      ok: false,
      message: '订阅 Topic 未填写',
      field: 'subscribeTopic',
    })
    await expect(
      adapter.validateConfig(makeCtx({ host: 'h', subscribeTopic: 's' }).ctx as never),
    ).resolves.toEqual({ ok: false, message: '发布 Topic 未填写', field: 'publishTopic' })
    await expect(adapter.validateConfig(makeCtx(CFG).ctx as never)).resolves.toEqual({ ok: true })
  })

  it('connect: mqtt:// url + 凭据,reconnectPeriod=0,连上即订阅并上报', async () => {
    const adapter = createMqttAdapter()
    const { ctx, onStatus } = makeCtx(CFG)
    const p = adapter.connect(ctx as never)
    await waitForConnectCalled()
    expect(mocks.connect).toHaveBeenCalledWith('mqtt://broker.local:1884', {
      username: 'u1',
      password: 'pw',
      reconnectPeriod: 0,
      connectTimeout: 10_000,
    })
    client.trigger('connect')
    await p
    expect(client.subscribed).toEqual(['in/t'])
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'connected' }))
    expect(adapter.getStatus().status).toBe('connected')
  })

  it('connect error: 状态 error 带 detail 并 reject', async () => {
    const adapter = createMqttAdapter()
    const { ctx, onStatus } = makeCtx(CFG)
    const p = adapter.connect(ctx as never)
    await waitForConnectCalled()
    client.trigger('error', new Error('auth failed'))
    await expect(p).rejects.toThrow('auth failed')
    expect(adapter.getStatus()).toMatchObject({ status: 'error', detail: 'auth failed' })
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error', detail: 'auth failed' }),
    )
  })

  it('connect 12s 超时: reject 连接超时', async () => {
    // 前两个测试已预热动态 import 缓存,此处假定时器微任务层即可解析
    vi.useFakeTimers()
    const adapter = createMqttAdapter()
    const { ctx } = makeCtx(CFG)
    const p = adapter.connect(ctx as never)
    const expectation = expect(p).rejects.toThrow('MQTT 连接超时')
    await vi.advanceTimersByTimeAsync(12_000)
    await expectation
  })

  it('入站消息: 字符串与 Buffer 载荷归一化透传,带 lastMessageAt', async () => {
    const adapter = createMqttAdapter()
    const { ctx, onMessage, onStatus } = makeCtx(CFG)
    const p = adapter.connect(ctx as never)
    await waitForConnectCalled()
    client.trigger('connect')
    await p

    client.trigger('message', 'in/t', 'hello')
    client.trigger('message', 'in/t', Buffer.from('buf 你好', 'utf8'))
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage.mock.calls[0][0]).toMatchObject({
      channel: 'mqtt',
      chat: { id: 'in/t', type: 'p2p' },
      sender: { id: 'in/t' },
      text: 'hello',
      attachments: [],
    })
    expect(onMessage.mock.calls[1][0].text).toBe('buf 你好')
    expect(onMessage.mock.calls[0][0].providerMessageId).toMatch(/^mqtt:in\/t:\d+$/)
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'connected', lastMessageAt: expect.any(Number) }),
    )
  })

  it('disconnect: end(true) 并归 disabled,幂等;出站防呆与 topic 覆盖', async () => {
    const adapter = createMqttAdapter()
    const { ctx } = makeCtx(CFG)
    const p = adapter.connect(ctx as never)
    await waitForConnectCalled()
    client.trigger('connect')
    await p

    await expect(
      adapter.sendReply({} as never, { text: '回复' } as never),
    ).resolves.toEqual({})
    expect(client.published).toEqual([['out/t', '回复']])
    await expect(
      adapter.push({ chatId: 'custom/t' } as never, { text: '推' } as never),
    ).resolves.toEqual({})
    expect(client.published[1]).toEqual(['custom/t', '推'])

    await adapter.disconnect()
    expect(client.ended).toBe(1)
    expect(adapter.getStatus().status).toBe('disabled')
    await adapter.disconnect()
    expect(client.ended).toBe(1)

    await expect(adapter.sendReply({} as never, { text: 'x' } as never)).rejects.toThrow(
      'MQTT 未连接',
    )
    await expect(adapter.push({} as never, { text: 'x' } as never)).rejects.toThrow(
      'MQTT 未连接',
    )
  })
})