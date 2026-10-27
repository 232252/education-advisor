// =============================================================
// app-lifecycle — 启动序列与渲染层韧性测试
// 全服务 mock + 可触发 FakeWin,锁定: dev/prod 加载分叉、IPC 注册
// 失败降级不白窗、渲染进程崩溃限次重载、加载失败重试与 data: 兜底、
// activate 复活语义、自动更新延迟检查。
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

const mocks = vi.hoisted(() => ({
  registerAppProtocol: vi.fn(),
  initLogger: vi.fn(),
  sweep: vi.fn(),
  configureDshNode: vi.fn(),
  configureDshRuntime: vi.fn(),
  configureDshCredentials: vi.fn(),
  resolveDshEntryPath: vi.fn(),
  ensureBridge: vi.fn(),
  stopBridge: vi.fn(),
  syncNativeTheme: vi.fn(),
  dbInit: vi.fn(),
  createMainWindow: vi.fn(),
  registerAllHandlers: vi.fn(),
  registerBitableSync: vi.fn(),
  registerAutoBackup: vi.fn(),
  initAutoBackup: vi.fn(),
  setWindow: vi.fn(),
  autoStart: vi.fn(),
  initTray: vi.fn(),
  refreshTrayMenu: vi.fn(),
  setStatusListener: vi.fn(),
  webUiInit: vi.fn(),
  checkForUpdates: vi.fn(),
  showUpdateDialog: vi.fn(),
  relaunch: vi.fn(),
  exitApp: vi.fn(),
  getAllWindows: vi.fn(),
  handleWindowClose: vi.fn(),
  listPiProviders: vi.fn(),
  getSettings: vi.fn(),
}))

function makeWin() {
  const loadURL = vi.fn(() => Promise.resolve())
  const handlers = new Map<string, Handler[]>()
  const onceHandlers = new Map<string, Handler[]>()
  return {
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((ev: string, fn: Handler) => {
        handlers.set(ev, [...(handlers.get(ev) ?? []), fn])
      }),
      once: vi.fn((ev: string, fn: Handler) => {
        onceHandlers.set(ev, [...(onceHandlers.get(ev) ?? []), fn])
      }),
      loadURL,
      openDevTools: vi.fn(),
      reload: vi.fn(),
    },
    on: vi.fn((ev: string, fn: Handler) => {
      handlers.set(ev, [...(handlers.get(ev) ?? []), fn])
    }),
    once: vi.fn((ev: string, fn: Handler) => {
      onceHandlers.set(ev, [...(onceHandlers.get(ev) ?? []), fn])
    }),
    loadURL,
    setIcon: vi.fn(),
    show: vi.fn(),
    trigger(ev: string, ...args: unknown[]) {
      const list = handlers.get(ev) ?? []
      for (const fn of list) fn(...args)
      const once = onceHandlers.get(ev) ?? []
      onceHandlers.delete(ev)
      for (const fn of once) fn(...args)
    },
  }
}

let currentWin: ReturnType<typeof makeWin>

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/userData'),
    getAppPath: vi.fn(() => 'C:/app'),
    isPackaged: false,
    once: vi.fn(),
    on: vi.fn(),
    relaunch: mocks.relaunch,
    exit: mocks.exitApp,
  },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
}))
vi.mock('@earendil-works/pi-ai/compat', () => ({ getEnvApiKey: vi.fn() }))
vi.mock('../../src/main/ipc/index', () => ({ registerAllHandlers: mocks.registerAllHandlers }))
vi.mock('../../src/main/services/backup-service', () => ({ initAutoBackup: mocks.initAutoBackup }))
vi.mock('../../src/main/services/channels/manager', () => ({
  channelManager: { setWindow: mocks.setWindow, autoStart: mocks.autoStart },
}))
vi.mock('../../src/main/services/cron-service', () => ({
  cronService: { registerBitableSync: mocks.registerBitableSync, registerAutoBackup: mocks.registerAutoBackup },
}))
vi.mock('../../src/main/services/db-service', () => ({ dbService: { init: mocks.dbInit } }))
vi.mock('../../src/main/services/dsh/dsh-node', () => ({ configureDshNode: mocks.configureDshNode }))
vi.mock('../../src/main/services/dsh/provider-patch', () => ({
  configureDshCredentials: mocks.configureDshCredentials,
}))
vi.mock('../../src/main/services/dsh/runtime', () => ({
  configureDshRuntime: mocks.configureDshRuntime,
  resolveDshEntryPath: mocks.resolveDshEntryPath,
}))
vi.mock('../../src/main/services/dsh/tool-bridge', () => ({
  ensureActiveEaaToolBridge: mocks.ensureBridge,
  stopActiveEaaToolBridge: mocks.stopBridge,
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { listProviders: vi.fn(() => []), getApiKey: vi.fn() },
}))
vi.mock('../../src/main/services/paths', () => ({
  resolveAppDataDir: vi.fn(() => 'C:/userData/app'),
  resolveEaaDataDir: vi.fn(() => 'C:/userData/eaa'),
}))
vi.mock('../../src/main/services/pi-ai/model-utils', () => ({ resolveModel: vi.fn() }))
vi.mock('../../src/main/services/pi-ai/providers', () => ({
  listProviders: mocks.listPiProviders,
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))
vi.mock('../../src/main/services/theme-service', () => ({ syncNativeTheme: mocks.syncNativeTheme }))
vi.mock('../../src/main/services/tray-service', () => ({
  initTray: mocks.initTray,
  refreshTrayMenu: mocks.refreshTrayMenu,
}))
vi.mock('../../src/main/services/update-service', () => ({
  updateService: { checkForUpdates: mocks.checkForUpdates, showUpdateDialog: mocks.showUpdateDialog },
}))
vi.mock('../../src/main/services/webui-service', () => ({
  webUiService: { setStatusListener: mocks.setStatusListener, init: mocks.webUiInit },
}))
vi.mock('../../src/main/utils/atomic-write', () => ({ sweepAtomicTmpResidue: mocks.sweep }))
vi.mock('../../src/main/utils/logger', () => ({
  initLogger: mocks.initLogger,
  log: vi.fn(),
}))
vi.mock('../../src/main/utils/open-external', () => ({ openExternalUrl: vi.fn() }))
vi.mock('../../src/main/bootstrap/app-protocol', () => ({ registerAppProtocol: mocks.registerAppProtocol }))
vi.mock('../../src/main/bootstrap/close-behavior', () => ({ handleWindowClose: mocks.handleWindowClose }))
vi.mock('../../src/main/bootstrap/window', () => ({
  createMainWindow: mocks.createMainWindow,
  resolveAppIcon: vi.fn(() => '/icon.png'),
}))

import { startApp } from '../../src/main/bootstrap/app-lifecycle'
import { mainState } from '../../src/main/bootstrap/state'

describe('app-lifecycle.startApp', () => {
  const envBackup = { ...process.env }
  const resourcesBackup = process.resourcesPath

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // 纯 node 无 resourcesPath(仅 Electron 运行时存在),注入合成值
    // @ts-expect-error 测试注入
    process.resourcesPath = 'C:/resources'
    delete process.env.VITE_DEV_SERVER_URL
    delete process.env.NODE_ENV_TEST_FLAG
    mocks.sweep.mockResolvedValue(0)
    mocks.listPiProviders.mockResolvedValue([])
    mocks.resolveDshEntryPath.mockReturnValue('C:/app/dsh.mjs')
    mocks.ensureBridge.mockResolvedValue({ port: 4321 })
    mocks.dbInit.mockResolvedValue(undefined)
    mocks.registerAllHandlers.mockResolvedValue(undefined)
    mocks.autoStart.mockResolvedValue(undefined)
    mocks.webUiInit.mockResolvedValue(undefined)
    currentWin = makeWin()
    mocks.createMainWindow.mockReturnValue(currentWin)
    mocks.getSettings.mockReturnValue({
      general: { logLevel: 'info', theme: 'system', autoUpdate: false },
      models: {},
    })
    mocks.checkForUpdates.mockResolvedValue({ hasUpdate: false })
    mocks.getAllWindows.mockReturnValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...envBackup }
    // @ts-expect-error 测试注入的合成属性
    process.resourcesPath = resourcesBackup
    mainState.mainWindow = null
  })

  it('生产启动: app:// 协议加载,协议/日志/db/IPC/频道/托盘全链就位', async () => {
    process.env.NODE_ENV = 'production'
    await startApp()
    expect(mocks.registerAppProtocol).toHaveBeenCalled()
    expect(mocks.initLogger).toHaveBeenCalledWith('info')
    expect(mocks.sweep).toHaveBeenCalled()
    expect(mocks.configureDshRuntime).toHaveBeenCalledWith(expect.objectContaining({
      dshBin: 'C:/app/dsh.mjs',
      cwd: 'C:/userData',
    }))
    expect(mocks.ensureBridge).toHaveBeenCalled()
    expect(mocks.dbInit).toHaveBeenCalled()
    expect(mocks.registerAllHandlers).toHaveBeenCalledWith(currentWin)
    expect(currentWin.webContents.loadURL).toHaveBeenCalledWith('app://index/index.html')
    expect(currentWin.webContents.openDevTools).not.toHaveBeenCalled()
    expect(mocks.registerBitableSync).toHaveBeenCalled()
    expect(mocks.registerAutoBackup).toHaveBeenCalled()
    expect(mocks.setWindow).toHaveBeenCalledWith(currentWin)
    expect(mocks.initTray).toHaveBeenCalledWith(currentWin)
    expect(mocks.webUiInit).toHaveBeenCalled()
    expect(mainState.mainWindow).toBe(currentWin)
  })

  it('开发启动: VITE_DEV_SERVER_URL 加载 dev 地址并开 DevTools', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173'
    await startApp()
    expect(currentWin.webContents.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(currentWin.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('IPC 注册失败降级: 记日志但渲染层照常加载(不白窗)', async () => {
    process.env.NODE_ENV = 'production'
    mocks.registerAllHandlers.mockRejectedValue(new Error('handler boom'))
    await startApp()
    expect(currentWin.webContents.loadURL).toHaveBeenCalledWith('app://index/index.html')
  })

  it('渲染进程崩溃: 非干净退出限 3 次自动重载,超限放弃;clean-exit 忽略', async () => {
    process.env.NODE_ENV = 'production'
    await startApp()
    const gone = (reason: string) =>
      currentWin.trigger('render-process-gone', {}, { reason, exitCode: 1 })

    gone('clean-exit')
    await vi.advanceTimersByTimeAsync(600)
    expect(currentWin.webContents.reload).not.toHaveBeenCalled()

    for (let i = 1; i <= 4; i++) {
      gone('crashed')
      await vi.advanceTimersByTimeAsync(600)
    }
    expect(currentWin.webContents.reload).toHaveBeenCalledTimes(3)
  })

  it('加载失败: 主帧失败 1s 后重试一次,再失败落 data: 兜底页;-3/子帧忽略', async () => {
    process.env.NODE_ENV = 'production'
    await startApp()
    const fail = (code: number, mainFrame = true) =>
      currentWin.trigger('did-fail-load', {}, code, 'err', 'app://x', mainFrame)

    fail(-3) // ABORTED 竞态忽略
    fail(-6, false) // 子帧忽略
    await vi.advanceTimersByTimeAsync(1100)
    expect(currentWin.webContents.loadURL).toHaveBeenCalledTimes(1) // 仅初始

    fail(-105) // 首次主帧失败 → 1s 后重试
    await vi.advanceTimersByTimeAsync(1100)
    expect(currentWin.webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(currentWin.webContents.loadURL).toHaveBeenLastCalledWith('app://index/index.html')

    fail(-105) // 再失败 → data: 兜底
    await vi.advanceTimersByTimeAsync(1100)
    const last = currentWin.webContents.loadURL.mock.calls.at(-1)?.[0] as string
    expect(last.startsWith('data:text/html')).toBe(true)
  })

  it('activate: 有主窗 show;无主窗且零窗口 relaunch+exit', async () => {
    process.env.NODE_ENV = 'production'
    await startApp()
    const electron = await import('electron')
    const activate = (electron.app.on as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (c) => c[0] === 'activate',
    )?.[1] as Handler

    activate()
    expect(currentWin.show).toHaveBeenCalled()

    mainState.mainWindow = null
    mocks.getAllWindows.mockReturnValue([])
    activate()
    expect(mocks.relaunch).toHaveBeenCalled()
    expect(mocks.exitApp).toHaveBeenCalledWith(0)
  })

  it('自动更新: autoUpdate 开启 5s 后检查;关闭零检查', async () => {
    process.env.NODE_ENV = 'production'
    mocks.getSettings.mockReturnValue({
      general: { logLevel: 'info', theme: 'system', autoUpdate: true },
      models: {},
    })
    await startApp()
    await vi.advanceTimersByTimeAsync(5100)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)

    mocks.checkForUpdates.mockClear()
    mocks.getSettings.mockReturnValue({
      general: { logLevel: 'info', theme: 'system', autoUpdate: false },
      models: {},
    })
    await startApp()
    await vi.advanceTimersByTimeAsync(5100)
    expect(mocks.checkForUpdates).not.toHaveBeenCalled()
  })
})