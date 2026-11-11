// =============================================================
// dsh-im-handlers — 连接中心子视图 IPC 边界测试
// 假 electron(WebContentsView/app/shell)+ 假 DshImWebHost + 捕获式
// handleIpc。锁定: bounds 防呆与取整、boot 失败重试、boundsTicket
// 作废、首贴 focus 次贴不抢焦点、hide、插件安装委托、stopDshImHost,
// 以及安全边界: window.open 只留本机回跳、will-navigate 跨源拦截。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DshImBounds } from '@shared/api/dsh-im'
import * as IPC from '@shared/ipc-channels'

const mocks = vi.hoisted(() => {
  class FakeWebContents {
    destroyed = false
    url = 'about:blank'
    windowOpenHandler: ((d: { url: string }) => { action: string }) | null = null
    navHandlers: Array<(e: { preventDefault: () => void }, url: string) => void> = []
    inputHandlers: Array<(e: { preventDefault: () => void }, i: unknown) => void> = []
    loadURL = vi.fn(async (u: string) => {
      this.url = u
    })
    focus = vi.fn()
    close = vi.fn(() => {
      this.destroyed = true
    })
    setWindowOpenHandler(fn: (d: { url: string }) => { action: string }) {
      this.windowOpenHandler = fn
    }
    on(ev: string, fn: never) {
      if (ev === 'will-navigate') this.navHandlers.push(fn as never)
      if (ev === 'before-input-event') this.inputHandlers.push(fn as never)
    }
    isDestroyed() {
      return this.destroyed
    }
    getURL() {
      return this.url
    }
  }

  const views: unknown[] = []
  class FakeView {
    webContents = new FakeWebContents()
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    setBoundsSpy = vi.fn((b: { x: number; y: number; width: number; height: number }) => {
      this.bounds = { ...b }
    })
    setBounds(b: { x: number; y: number; width: number; height: number }) {
      this.setBoundsSpy(b)
    }
    constructor() {
      views.push(this)
    }
    getBounds() {
      return this.bounds
    }
  }

  return {
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    views,
    FakeView,
    open: vi.fn(),
    stop: vi.fn(),
    hostCtor: vi.fn(),
    openExternal: vi.fn(),
    pluginInstall: vi.fn(),
    prepareLaunch: vi.fn(),
    releaseLaunch: vi.fn(),
    send: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/userData'),
    isPackaged: false,
    getAppPath: vi.fn(() => 'C:/app'),
  },
  shell: { openExternal: mocks.openExternal },
  WebContentsView: class {
    constructor() {
      // 构造时动态取,支持测试内换桩
      const Ctor = mocks.FakeView as new () => unknown
      return new Ctor()
    }
  },
}))
vi.mock('../../src/main/ipc/handle', () => ({
  handleIpc: (ch: string, fn: (...args: unknown[]) => Promise<unknown>) => {
    mocks.handlers.set(ch, fn)
  },
}))
vi.mock('../../src/main/services/dsh/im-host', () => ({
  DSH_IM_STAMP: 'im.stamp',
  DSH_IM_INSTALL_STAMP: 'im-installed',
  DshImWebHost: class {
    constructor(opts: unknown) {
      mocks.hostCtor(opts)
    }
    open = mocks.open
    stop = mocks.stop
  },
}))
vi.mock('../../src/main/services/dsh/plugin-status', () => ({
  readEducationPluginInstall: mocks.pluginInstall,
}))
vi.mock('../../src/main/services/dsh/im-education', () => ({
  prepareDshImEducationLaunch: mocks.prepareLaunch,
  releaseDshImEducationLaunch: mocks.releaseLaunch,
}))
vi.mock('../../src/main/services/dsh/dsh-node', () => ({
  resolveSystemNode: vi.fn(() => 'C:/node/node.exe'),
}))
vi.mock('../../src/main/services/dsh/runtime', () => ({
  isElectronMainProcess: vi.fn(() => false),
  // 开发态还没解压 runtime zip，走 resolveDshEntryPath。
  getConfiguredDshBin: vi.fn(() => undefined),
  resolveDshEntryPath: vi.fn(() => 'C:/app/dsh.mjs'),
}))
vi.mock('../../src/main/services/dsh/bundled-archive', () => ({
  waitForDshRuntime: vi.fn(() => Promise.resolve()),
  waitForDshImRoot: vi.fn(() => Promise.resolve(undefined)),
}))

import {
  registerDshImHandlers,
  stopDshImHost,
} from '../../src/main/ipc/dsh-im-handlers'

function makeWin(destroyed = false) {
  const children: unknown[] = []
  return {
    destroyed,
    isDestroyed: () => destroyed,
    contentView: {
      children,
      removeChildView: (c: unknown) => {
        const i = children.indexOf(c)
        if (i >= 0) children.splice(i, 1)
      },
      addChildView: (c: unknown) => {
        children.push(c)
      },
    },
    webContents: { send: mocks.send },
  }
}

const BOUNDS: DshImBounds = { x: 10, y: 20, width: 400, height: 300 }

async function callShow(win: ReturnType<typeof makeWin>, bounds: DshImBounds) {
  const fn = mocks.handlers.get(IPC.IPC_DSH_IM_SHOW)
  if (!fn) throw new Error('show not registered')
  return (await fn({} as never, bounds)) as { ok: boolean; error?: string }
}

describe('dsh-im-handlers', () => {
  let win: ReturnType<typeof makeWin>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.views.length = 0
    stopDshImHost()
    win = makeWin()
    registerDshImHandlers(win as never)
    mocks.open.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:4900/im' })
  })

  it('bounds 防呆: 非有限值/过小拒;小数取整', async () => {
    await expect(callShow(win, { x: Number.NaN, y: 0, width: 10, height: 10 })).resolves.toEqual(
      { ok: false, error: '连接中心区域还没有布局好' },
    )
    await expect(callShow(win, { x: 0, y: 0, width: 7, height: 300 })).resolves.toMatchObject({
      ok: false,
    })

    const r = await callShow(win, { x: 10.6, y: 20.2, width: 400.4, height: 300.4 })
    expect(r.ok).toBe(true)
    const last = mocks.views[0].setBoundsSpy.mock.calls.at(-1)?.[0]
    expect(last).toMatchObject({ x: 11, y: 20, width: 400, height: 300 })
  })

  it('show 成功链: 首贴 loadURL+摆放+focus;次贴不抢焦点', async () => {
    const r1 = await callShow(win, BOUNDS)
    expect(r1.ok).toBe(true)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(mocks.views).toHaveLength(1)
    expect(mocks.views[0].webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:4900/im')
    expect(mocks.views[0].webContents.focus).toHaveBeenCalledTimes(1)
    // 摆放舞步: 摘下 → 1×1 → x+1 → 终值
    const xs = mocks.views[0].setBoundsSpy.mock.calls.map((c) => c[0].x)
    expect(xs).toEqual([0, 11, 10])

    const r2 = await callShow(win, { ...BOUNDS, x: 50 })
    expect(r2.ok).toBe(true)
    expect(mocks.views[0].webContents.focus).toHaveBeenCalledTimes(1) // 不再 focus
    expect(mocks.open).toHaveBeenCalledTimes(1) // host 复用
  })

  it('boot 缓存语义: ok=false 重试;ok=true 但无 url 也缓存(不再重开)', async () => {
    mocks.open.mockResolvedValueOnce({ ok: false, error: '端口占用' })
    await expect(callShow(win, BOUNDS)).resolves.toEqual({ ok: false, error: '端口占用' })
    mocks.open.mockResolvedValueOnce({ ok: true }) // 无 url
    await expect(callShow(win, BOUNDS)).resolves.toEqual({
      ok: false,
      error: 'IM 面板没有返回地址',
    })
    // 源码语义: ok=true 即缓存 boot(即使缺 url),第三次不重开
    await expect(callShow(win, BOUNDS)).resolves.toEqual({
      ok: false,
      error: 'IM 面板没有返回地址',
    })
    expect(mocks.open).toHaveBeenCalledTimes(2)
  })

  it('boundsTicket 作废: 慢 boot 期间新 show 到达,旧 show 不再摆放', async () => {
    let resolveBoot: (v: unknown) => void = () => {}
    mocks.open.mockImplementationOnce(
      () => new Promise((res) => { resolveBoot = res }),
    )
    const slow = callShow(win, BOUNDS)
    const fast = callShow(win, { ...BOUNDS, x: 99 })
    // getHost 先等 runtime zip。open 挂上之后再放行，慢请求才进同一个 boot。
    await vi.waitFor(() => {
      expect(mocks.open).toHaveBeenCalledTimes(1)
    })
    resolveBoot({ ok: true, url: 'http://127.0.0.1:4900/im' })
    await slow
    await fast
    expect(mocks.views[0].setBoundsSpy.mock.calls.at(-1)?.[0].x).toBe(99)
  })

  it('hide: 从 contentView 摘除;Escape 关闭并广播 closed', async () => {
    await callShow(win, BOUNDS)
    const hide = mocks.handlers.get(IPC.IPC_DSH_IM_HIDE)
    await hide?.({} as never)
    expect(win.contentView.children).toHaveLength(0)

    // before-input-event: Escape → 隐藏 + closed 广播
    await callShow(win, BOUNDS)
    const view = mocks.views[0]
    const evt = { preventDefault: vi.fn() }
    view.webContents.inputHandlers[0](evt as never, { type: 'keyDown', key: 'Escape' })
    expect(win.contentView.children).toHaveLength(0)
    expect(mocks.send).toHaveBeenCalledWith(IPC.IPC_DSH_IM_CLOSED)
    // Alt+C 同效;普通按键忽略
    mocks.send.mockClear()
    view.webContents.inputHandlers[0](
      { preventDefault: vi.fn() } as never,
      { type: 'keyDown', key: 'c', alt: true, control: false, meta: false },
    )
    expect(mocks.send).toHaveBeenCalledTimes(1)
    view.webContents.inputHandlers[0](
      { preventDefault: vi.fn() } as never,
      { type: 'keyDown', key: 'a' },
    )
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('安全边界: window.open 只留本机回跳,外站交系统浏览器', async () => {
    await callShow(win, BOUNDS)
    const wc = mocks.views[0].webContents
    const deny = { action: 'deny' }

    const r1 = wc.windowOpenHandler?.({ url: 'http://127.0.0.1:4900/login' })
    expect(r1).toEqual(deny)
    expect(wc.loadURL).toHaveBeenLastCalledWith('http://127.0.0.1:4900/login')

    expect(wc.windowOpenHandler?.({ url: 'https://evil.example.com/x' })).toEqual(deny)
    expect(mocks.openExternal).toHaveBeenCalledWith('https://evil.example.com/x')
  })

  it('安全边界: will-navigate 同源/本机互换放行,跨源拦截交系统浏览器', async () => {
    await callShow(win, BOUNDS)
    const wc = mocks.views[0].webContents
    const nav = wc.navHandlers[0]

    const allow = { preventDefault: vi.fn() }
    nav(allow as never, 'http://127.0.0.1:4900/im') // about:blank 起步直接放
    expect(allow.preventDefault).not.toHaveBeenCalled()

    wc.url = 'http://127.0.0.1:4900/im'
    nav(allow as never, 'http://localhost:4900/im') // 403 改走 localhost 同属本机
    expect(allow.preventDefault).not.toHaveBeenCalled()

    const block = { preventDefault: vi.fn() }
    nav(block as never, 'https://evil.example.com/phish')
    expect(block.preventDefault).toHaveBeenCalled()
    expect(mocks.openExternal).toHaveBeenCalledWith('https://evil.example.com/phish')
  })

  it('plugin-install: 委托 readEducationPluginInstall 带期望参数', async () => {
    mocks.pluginInstall.mockResolvedValue({ installed: true })
    const fn = mocks.handlers.get(IPC.IPC_DSH_IM_PLUGIN_INSTALL)
    await expect(fn?.({} as never)).resolves.toEqual({ installed: true })
    expect(mocks.pluginInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        imStampName: 'im.stamp',
        imStampValue: 'im-installed',
        vendorRoot: expect.stringContaining('vendor'),
        sdkHome: expect.stringContaining('dsh-sdk-home'),
        webHome: expect.stringContaining('dsh-web-home'),
      }),
    )
  })

  it('stopDshImHost: 关视图停主机', async () => {
    await callShow(win, BOUNDS)
    stopDshImHost()
    expect(mocks.views[0].webContents.close).toHaveBeenCalled()
    expect(mocks.stop).toHaveBeenCalled()
  })
})