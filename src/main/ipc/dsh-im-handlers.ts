// =============================================================
// dsh-im 连接中心：主进程里开一块 WebContentsView
//
// dsh web 的登录 cookie 是 SameSite=Strict。渲染进程用 iframe 去嵌
// 127.0.0.1 时，303 换 cookie 的那一步会被浏览器丢掉，面板只能看到 401。
// 所以这块页面作为窗口自己的子视图加载，令牌不进渲染进程。
// =============================================================

import { dirname, join } from 'node:path'
import type { DshImBounds, DshImShowResult } from '@shared/api/dsh-im'
import * as IPC from '@shared/ipc-channels'
import type { Rectangle } from 'electron'
import { app, type BrowserWindow, shell, WebContentsView } from 'electron'
import { resolveSystemNode } from '../services/dsh/dsh-node'
import {
  prepareDshImEducationLaunch,
  releaseDshImEducationLaunch,
} from '../services/dsh/im-education'
import { DSH_IM_INSTALL_STAMP, DSH_IM_STAMP, DshImWebHost } from '../services/dsh/im-host'
import { readEducationPluginInstall } from '../services/dsh/plugin-status'
import { isElectronMainProcess, resolveDshEntryPath } from '../services/dsh/runtime'
import { handleIpc } from './handle'

let mainWindow: BrowserWindow | null = null
let host: DshImWebHost | null = null
let view: WebContentsView | null = null
let boot: Promise<DshImShowResult & { url?: string }> | null = null
let visible = false
let pageLoad: Promise<void> | null = null
/** 后到的 show 作废先到的摆放，避免缩放时旧坐标盖住新坐标。 */
let boundsTicket = 0

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function imRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'dsh-im')
    : join(app.getAppPath(), 'vendor', 'dsh-im')
}

function toolsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'eaa-tools')
    : join(app.getAppPath(), 'vendor', 'eaa-tools')
}

function getHost(): DshImWebHost {
  if (!host) {
    host = new DshImWebHost({
      home: join(app.getPath('userData'), 'dsh-web-home'),
      dshBin: resolveDshEntryPath(app.getAppPath()) ?? '',
      imDir: imRoot(),
      toolsDir: toolsRoot(),
      execPath: resolveSystemNode() ?? process.execPath,
      electronAsNode: resolveSystemNode() === undefined && isElectronMainProcess(),
      prepareLaunch: (patchDir) =>
        prepareDshImEducationLaunch({ patchDir, win: mainWindow ?? undefined }),
      releaseLaunch: releaseDshImEducationLaunch,
    })
  }
  return host
}

function asBounds(raw: DshImBounds): Rectangle | null {
  const x = Number(raw?.x)
  const y = Number(raw?.y)
  const width = Number(raw?.width)
  const height = Number(raw?.height)
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null
  if (width < 8 || height < 8) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function ensureView(win: BrowserWindow): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view
  view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    // 登录回跳还在本机 dsh web 上，留在这块视图里；外站交给系统浏览器。
    if (parsed && isLoopbackHost(parsed.hostname) && view && !view.webContents.isDestroyed()) {
      void view.webContents.loadURL(url)
      return { action: 'deny' }
    }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  view.webContents.on('will-navigate', (event, url) => {
    const current = view?.webContents.getURL()
    if (!current || current === 'about:blank') return
    let next: URL
    let base: URL
    try {
      next = new URL(url)
      base = new URL(current)
    } catch {
      return
    }
    if (next.origin === base.origin) return
    // dsh-im 在 127.0.0.1 被 403 时会改走 localhost，这仍是同一块本机页面。
    if (isLoopbackHost(next.hostname) && isLoopbackHost(base.hostname)) return
    event.preventDefault()
    if (next.protocol === 'https:' || next.protocol === 'http:') void shell.openExternal(url)
  })
  view.webContents.on('before-input-event', (event, input) => {
    const close =
      input.type === 'keyDown' &&
      (input.key === 'Escape' ||
        (input.alt && !input.control && !input.meta && (input.key === 'c' || input.key === 'C')))
    if (!close) return
    event.preventDefault()
    hideView(win)
    if (!win.isDestroyed()) win.webContents.send(IPC.IPC_DSH_IM_CLOSED)
  })
  return view
}

function place(win: BrowserWindow, bounds: Rectangle): void {
  const child = ensureView(win)
  // Electron 43 在这块子视图已经挂上之后，再 setBounds 经常只改宽高、把 x 留在 0。
  // 先摘下来，用一个不同的 x 写一次，再写成测量值，getBounds 才和窗口坐标一致。
  if (win.contentView.children.includes(child)) win.contentView.removeChildView(child)
  child.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  win.contentView.addChildView(child)
  child.setBounds({ ...bounds, x: bounds.x + 1 })
  child.setBounds(bounds)
  const got = child.getBounds()
  if (got.x !== bounds.x || got.y !== bounds.y) {
    console.error(
      `[dsh-im] place asked=${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} got=${got.x},${got.y} ${got.width}x${got.height}`,
    )
  }
}

function hideView(win: BrowserWindow): void {
  visible = false
  if (!view) return
  try {
    win.contentView.removeChildView(view)
  } catch {
    // 窗口已经关了
  }
}

async function ensureBoot(): Promise<DshImShowResult & { url?: string }> {
  if (!boot) {
    boot = getHost()
      .open()
      .then((result) => {
        if (!result.ok) boot = null
        return result
      })
      .catch((err: unknown) => {
        boot = null
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      })
  }
  return boot
}

export function stopDshImHost(): void {
  visible = false
  boot = null
  pageLoad = null
  const current = view
  view = null
  if (current && !current.webContents.isDestroyed()) current.webContents.close()
  host?.stop()
  host = null
}

export function registerDshImHandlers(win: BrowserWindow): void {
  mainWindow = win
  handleIpc(IPC.IPC_DSH_IM_SHOW, async (_event, bounds: DshImBounds) => {
    const next = asBounds(bounds)
    if (!next) return { ok: false, error: '连接中心区域还没有布局好' }
    if (win.isDestroyed()) return { ok: false, error: '主窗口已经关闭' }
    visible = true
    const ticket = ++boundsTicket
    const result = await ensureBoot()
    if (ticket !== boundsTicket || !visible || win.isDestroyed())
      return result.ok ? { ok: true } : result
    if (!result.ok || !result.url)
      return { ok: false, error: result.error || 'IM 面板没有返回地址' }
    const child = ensureView(win)
    if (!pageLoad) {
      pageLoad = child.webContents.loadURL(result.url).catch((err: unknown) => {
        pageLoad = null
        throw err
      })
    }
    await pageLoad
    if (ticket !== boundsTicket || !visible || win.isDestroyed()) return { ok: true }
    const wasPlaced = win.contentView.children.includes(child)
    place(win, next)
    // 第一次贴上才把键盘交给 IM 页。之后只为对齐改位置，再 focus 会把正在点的
    // 「数据同步」或主窗口输入抢走。
    if (!wasPlaced && !child.webContents.isDestroyed()) child.webContents.focus()
    return { ok: true }
  })

  handleIpc(IPC.IPC_DSH_IM_HIDE, async () => {
    if (!win.isDestroyed()) hideView(win)
  })

  handleIpc(IPC.IPC_DSH_IM_PLUGIN_INSTALL, async () =>
    readEducationPluginInstall({
      vendorRoot: dirname(toolsRoot()),
      sdkHome: join(app.getPath('userData'), 'dsh-sdk-home'),
      webHome: join(app.getPath('userData'), 'dsh-web-home'),
      imStampName: DSH_IM_STAMP,
      imStampValue: DSH_IM_INSTALL_STAMP,
    }),
  )
}
