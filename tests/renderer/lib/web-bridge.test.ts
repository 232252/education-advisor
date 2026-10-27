// =============================================================
// web-bridge — 浏览器 WebUI WS 桥接测试
// 假 WebSocket(捕获 url/sent/事件)+ 捕获 setIpcRuntime,锁定:
// token 读取与 URL 清理、ws/wss 传输选择、invoke 应答/错误配对、
// 事件订阅与退订、send 直发、close 拒绝挂起、8s 超时、无 token 拒装。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setIpcRuntime: vi.fn(),
  setWebUiRuntime: vi.fn(),
  instances: [] as Array<FakeWS>,
}))

type Fn = (...args: unknown[]) => void

class FakeWS {
  url: string
  sent: string[] = []
  listeners = new Map<string, Fn[]>()
  constructor(url: string) {
    this.url = url
    mocks.instances.push(this)
  }
  addEventListener(ev: string, fn: Fn) {
    this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn])
  }
  send(data: string) {
    this.sent.push(data)
  }
  trigger(ev: string, arg: unknown) {
    for (const fn of this.listeners.get(ev) ?? []) fn(arg)
  }
}

vi.mock('@shared/ipc-runtime', () => ({ setIpcRuntime: mocks.setIpcRuntime }))
vi.mock('../../../src/renderer/lib/runtime-env', () => ({
  setWebUiRuntime: mocks.setWebUiRuntime,
}))

import { installWebBridge } from '../../../src/renderer/lib/web-bridge'

function lastRuntime(): {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (data: unknown) => void) => () => void
  send: (channel: string, ...args: unknown[]) => void
} {
  return mocks.setIpcRuntime.mock.calls.at(-1)?.[0] as never
}

describe('installWebBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.instances.length = 0
    vi.stubGlobal('WebSocket', FakeWS)
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('无 token: 拒装不建连接', async () => {
    await expect(installWebBridge()).resolves.toBe(false)
    expect(mocks.instances).toHaveLength(0)
    expect(mocks.setIpcRuntime).not.toHaveBeenCalled()
  })

  it('?k= token: 落 sessionStorage、URL 清理、ws 传输、open 后装 runtime', async () => {
    window.history.replaceState(null, '', '/?k=TOK123&x=1')
    const p = installWebBridge()
    const ws = mocks.instances[0]
    expect(ws.url).toBe(`ws://${window.location.host}/ws?k=TOK123`)
    ws.trigger('open', undefined)
    await expect(p).resolves.toBe(true)
    expect(sessionStorage.getItem('ea-webui-k')).toBe('TOK123')
    // k 参数被清,其余参数保留
    expect(window.location.search).toBe('?x=1')
    expect(mocks.setWebUiRuntime).toHaveBeenCalledWith(true)
    expect(mocks.setIpcRuntime).toHaveBeenCalledTimes(1)
  })

  it('sessionStorage 已有 token 也生效(wss 当 https)', async () => {
    sessionStorage.setItem('ea-webui-k', 'SAVED')
    const p = installWebBridge()
    const ws = mocks.instances[0]
    expect(ws.url).toContain('/ws?k=SAVED')
    ws.trigger('open', undefined)
    await expect(p).resolves.toBe(true)
  })

  it('invoke: 递增 id 配对应答;error 回复转 reject;垃圾帧忽略', async () => {
    sessionStorage.setItem('ea-webui-k', 'T')
    const p = installWebBridge()
    const ws = mocks.instances[0]
    ws.trigger('open', undefined)
    await p
    const rt = lastRuntime()

    const r1 = rt.invoke('db:query', 1, 2)
    const r2 = rt.invoke('db:other')
    expect(JSON.parse(ws.sent[0])).toEqual({ id: '1', type: 'invoke', channel: 'db:query', args: [1, 2] })
    expect(JSON.parse(ws.sent[1])).toMatchObject({ id: '2', channel: 'db:other' })

    ws.trigger('message', { data: 'garbage{{{' })
    ws.trigger('message', { data: JSON.stringify({ id: '999', data: '孤儿应答' }) })
    ws.trigger('message', { data: JSON.stringify({ id: '2', type: 'error', message: 'boom' }) })
    await expect(r2).rejects.toThrow('boom')
    ws.trigger('message', { data: JSON.stringify({ id: '1', type: 'result', data: { ok: 1 } }) })
    await expect(r1).resolves.toEqual({ ok: 1 })
  })

  it('on: 事件按频道派发、退订生效;send 直发无 id', async () => {
    sessionStorage.setItem('ea-webui-k', 'T')
    const p = installWebBridge()
    const ws = mocks.instances[0]
    ws.trigger('open', undefined)
    await p
    const rt = lastRuntime()

    const got: unknown[] = []
    const off = rt.on('ch:a', (d) => got.push(d))
    ws.trigger('message', { data: JSON.stringify({ type: 'event', channel: 'ch:b', data: 1 }) })
    expect(got).toEqual([])
    ws.trigger('message', { data: JSON.stringify({ type: 'event', channel: 'ch:a', data: 42 }) })
    expect(got).toEqual([42])
    off()
    ws.trigger('message', { data: JSON.stringify({ type: 'event', channel: 'ch:a', data: 43 }) })
    expect(got).toEqual([42])

    rt.send('ui:toast', 'hi')
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({
      type: 'send',
      channel: 'ui:toast',
      args: ['hi'],
    })
  })

  it('close: 挂起 invoke 全部拒绝', async () => {
    sessionStorage.setItem('ea-webui-k', 'T')
    const p = installWebBridge()
    const ws = mocks.instances[0]
    ws.trigger('open', undefined)
    await p
    const rt = lastRuntime()
    const r = rt.invoke('db:x')
    ws.trigger('close', undefined)
    await expect(r).rejects.toThrow('WebUI connection closed')
  })

  it('8s 未 open: 超时拒装', async () => {
    vi.useFakeTimers()
    try {
      sessionStorage.setItem('ea-webui-k', 'T')
      const p = installWebBridge()
      const expectation = expect(p).resolves.toBe(false)
      await vi.advanceTimersByTimeAsync(8100)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })
})