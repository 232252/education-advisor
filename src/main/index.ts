// =============================================================
// Electron 主进程入口
// 技术方向：Electron 33 + Node.js 22
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { registerAllHandlers } from './ipc/index'
import { mainBroadcaster } from './services/broadcaster'
import { cronService } from './services/cron-service'
import { dbService } from './services/db-service'
import { settingsService } from './services/settings-service'
import { destroyTray, getTrayStatus, initTray, resolveIconPath } from './services/tray-service'
import { updateService } from './services/update-service'
import { initLogger, log } from './utils/logger'

// 全局窗口引用
let mainWindow: BrowserWindow | null = null
let isQuitting = false

// 启用 CDP 远程调试 — 默认关闭,可由用户开启"远程维修模式"开关 (settings.general.remoteMaintenance=true) 或环境变量 EA_CDP=1 临时开启。
// 安全护栏:
//   - Chromium 原生 CDP server 仅监听 127.0.0.1:9222 (本地安全)
//   - 我们在主进程起一个透明 TCP 双栈代理,监听 0.0.0.0:9222 (IPv4) + [::]:9222 (IPv6),
//     把外部流量字节级转发到 127.0.0.1:9222 的原生 CDP server。
//   - remote-allow-origins=* 允许任意 DevTools 客户端连接
//   - 设置 EA_CDP=0 可显式关闭(优先级最高,绕过 settings 开关)
//   - 设置 EA_CDP=1 可临时开启(优先级最高,绕过 settings 开关)
// 设计原因: Chromium 不支持 --remote-debugging-address (官方文档未列),且就算支持
// 也只对单 family 生效。我们要双栈 (IPv4 + IPv6),所以用 Node.js net proxy 接管。
const _eaCdpEnv = process.env.EA_CDP
const _enableCdp =
  _eaCdpEnv === '1' ||
  (_eaCdpEnv !== '0' && settingsService.getSettings().general.remoteMaintenance === true)
if (_enableCdp) {
  // Chromium 原生只听本地 127.0.0.1:9222。Chromium 对 '127.0.0.1:9222' 这种
  // HOST:PORT 格式解析有 bug (会静默忽略整个参数,导致 CDP server 不启动),
  // 实测发现传纯端口号 '9222' 才会正确启动 CDP server (默认 bind 127.0.0.1)。
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  app.commandLine.appendSwitch('remote-allow-origins', '*')
  // 打开主进程 Node.js Inspector,挂在 9230 端口(主进程 console.log 可被外部抓取)
  // electron 本身已内置,只需要传 --inspect=9230
  process.argv.push(`--inspect=0.0.0.0:9230`)
  const source = _eaCdpEnv === '1' ? 'env EA_CDP=1' : 'settings.general.remoteMaintenance=true'
  console.log(
    `[Main] CDP enabled (${source}): renderer @ http://127.0.0.1:9222  main @ ws://127.0.0.1:9230`,
  )
  console.log('[Main] External access via dual-stack proxy: IPv4 0.0.0.0:9222 / IPv6 [::]:9222')
  console.log(
    '[Main] Inspect via Chrome DevTools: chrome://inspect → Configure → add localhost:9222',
  )
  console.log(
    '[Main] To disable: set EA_CDP=0 env var before launch, or toggle off in Settings → General → 远程维修模式',
  )
}

// =============================================================
// 双栈 TCP 代理: 0.0.0.0:9222 (IPv4) + [::]:9222 (IPv6) → 127.0.0.1:9222 (Chromium 原生)
// net.createServer 不解析 HTTP/WS,纯字节转发,天然兼容 /json、/json/version、WebSocket 等。
// =============================================================
function _startCdpProxy(): void {
  if (!_enableCdp) return
  app.whenReady().then(() => {
    // 等 Chromium CDP server 起来 (一般 < 1s,保险起见 1.5s)
    setTimeout(() => {
      const net = require('node:net') as typeof import('node:net')
      const handler = (): import('node:net').Server =>
        net.createServer((client) => {
          const upstream = net.connect(9222, '127.0.0.1', () => {
            client.pipe(upstream)
            upstream.pipe(client)
          })
          const cleanup = (): void => {
            if (!client.destroyed) client.destroy()
            if (!upstream.destroyed) upstream.destroy()
          }
          upstream.on('error', cleanup)
          client.on('error', cleanup)
          upstream.on('close', cleanup)
          client.on('close', cleanup)
        })

      // IPv4 全接口 (内网 + 公网 IPv4 路由器转发场景)
      const ipv4Proxy = handler()
      ipv4Proxy.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') console.error('[Main] CDP IPv4 proxy failed:', err.message)
      })
      ipv4Proxy.listen(9222, '0.0.0.0', () => {
        console.log('[Main] CDP proxy [v4] 0.0.0.0:9222 → 127.0.0.1:9222 ready')
      })

      // IPv6 全接口 (移动宽带 IPv6 公网直连场景,无需路由器端口转发)
      const ipv6Proxy = handler()
      ipv6Proxy.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') console.error('[Main] CDP IPv6 proxy failed:', err.message)
      })
      ipv6Proxy.listen(9222, '::', () => {
        console.log('[Main] CDP proxy [v6] [::]:9222 → 127.0.0.1:9222 ready')
      })
    }, 1500)
  })
}
_startCdpProxy()

// =============================================================
// 关闭行为处理
// =============================================================
function handleWindowClose(win: BrowserWindow, event: Electron.Event): void {
  if (isQuitting) return

  const settings = settingsService.getSettings()
  const behavior = settings.general.closeBehavior

  switch (behavior) {
    case 'tray':
      event.preventDefault()
      win.hide()
      break

    case 'exit':
      isQuitting = true
      break
    default: {
      // 同步阻止关闭，然后异步弹对话框
      // 读取语言设置（默认中文）
      let lang = 'zh-CN'
      try {
        const fs = require('node:fs')
        const settingsPath = path.join(app.getPath('userData'), 'settings.json')
        if (fs.existsSync(settingsPath)) {
          const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
          lang = s.general?.language || 'zh-CN'
        }
      } catch {
        /* use default */
      }
      const isZh = lang === 'zh-CN'
      event.preventDefault()
      dialog
        .showMessageBox(win, {
          type: 'question',
          title: isZh ? '关闭窗口' : 'Close Window',
          message: isZh ? '您希望如何处理？' : 'What would you like to do?',
          buttons: isZh
            ? ['最小化到托盘', '直接退出', '取消']
            : ['Minimize to tray', 'Exit', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          checkboxLabel: isZh ? '记住选择' : 'Remember my choice',
          checkboxChecked: false,
        })
        .then((result) => {
          const buttonIndex = result.response
          const remember = result.checkboxChecked

          if (buttonIndex === 2) {
            // 取消 — 什么都不做
            return
          }

          if (remember) {
            const newBehavior = buttonIndex === 0 ? 'tray' : 'exit'
            settingsService.update('general.closeBehavior', newBehavior)
          }

          if (buttonIndex === 0) {
            win.hide()
          } else {
            isQuitting = true
            app.quit()
          }
        })
        .catch(() => {
          /* dialog cancelled or error */
        })
      break
    }
  }
}

// =============================================================
// App 生命周期
// =============================================================
app.whenReady().then(async () => {
  // T5: 初始化日志系统(从 settings 读 logLevel,劫持 console)
  const initialLogLevel = settingsService.getSettings().general.logLevel
  initLogger(initialLogLevel)
  log('info', 'main', `Logger initialized at level=${initialLogLevel}`)

  // P2-4: 初始化 SQLite,失败不阻塞主流程
  await dbService.init()

  const iconPath = resolveIconPath()
  if (!iconPath) {
    console.warn('[Main] No icon found, using Electron default')
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Education Advisor · 教育参谋',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      // P0-2 修复: 启动期断言 preload.js 存在，避免 vite build 产物改名（.mjs/.cjs）后静默失效
      preload: (() => {
        const preloadPath = path.join(__dirname, 'preload.js')
        if (!fs.existsSync(preloadPath)) {
          throw new Error(
            `[Main] preload not found at ${preloadPath} — vite build 产物可能改名（preload.mjs/cjs），` +
              `请确认 vite.config.ts 输出格式与 main 入口一致`,
          )
        }
        return preloadPath
      })(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false,
  })

  // 启用远程调试(在 app.whenReady 顶部已 appendSwitch,这里只是占位日志)
  mainWindow = win
  // P2-3: 注册主窗口到广播器, 让 Agent 工具 / cron 任务也能向渲染端推送事件
  mainBroadcaster.setMainWindow(win)

  // 注册所有 IPC 处理器（同步注册 + 异步初始化）
  await registerAllHandlers(win)

  // 注册飞书 Bitable 定时同步任务
  cronService.registerBitableSync()

  // 外部链接在系统浏览器中打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 读取设置，按需创建系统托盘(委托给 tray-service)
  initTray(win)

  // 启动后延迟检查更新（避免启动卡顿）
  setTimeout(() => {
    try {
      const s = settingsService.getSettings()
      if (s.general.autoUpdate) {
        updateService
          .checkForUpdates()
          .then((info) => {
            if (info.hasUpdate) {
              log('info', 'main', `Update available: v${info.latestVersion}`)
              updateService.showUpdateDialog()
            }
          })
          .catch((err) => {
            log('warn', 'main', `Auto-update check failed: ${err}`)
          })
      }
    } catch {
      /* settings 未就绪时忽略 */
    }
  }, 5000)

  // 关闭事件拦截
  win.on('close', (event) => {
    handleWindowClose(win, event)
  })

  win.on('closed', () => {
    mainWindow = null
    // P2-3: 窗口销毁时清理广播器, 防止后续 webContents.send 报错
    mainBroadcaster.clearMainWindow()
  })

  // 加载渲染进程
  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  // 监听渲染进程控制台消息，输出到主进程
  win.webContents.on('console-message', (_event, level, message, _line, sourceId) => {
    const prefix = `[Renderer ${level}]`
    console.log(`${prefix} ${message} (${sourceId})`)
  })

  // 监听渲染进程崩溃
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Renderer] Process gone: ${details.reason} (exitCode=${details.exitCode})`)
  })

  // 监听页面加载失败
  win.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    console.error(`[Renderer] Load failed: ${errorCode} ${errorDesc} URL=${validatedURL}`)
  })

  // 初始化完成后显示窗口
  win.once('ready-to-show', () => {
    win.show()
  })

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      app.relaunch()
      app.exit(0)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 有托盘时不退出（除非 isQuitting 为 true）
    const { exists: trayExists } = getTrayStatus()
    if (trayExists && !isQuitting) return
    // 真正要退出时才关闭服务
    void cronService.shutdown()
    void dbService.close()
    app.quit()
  }
})

// 退出前清理托盘
app.on('before-quit', () => {
  isQuitting = true
  destroyTray()
})

// 安全：阻止导航到外部页面
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault()
  })
})
