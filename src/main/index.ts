// =============================================================
// Electron 主进程入口
// 技术方向：Electron 33 + Node.js 22
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { registerAllHandlers } from './ipc/index'
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
//   - 仅监听 127.0.0.1,不开 0.0.0.0
//   - remote-allow-origins=* 允许任意 DevTools 客户端连接(本地排查用)
//   - 设置 EA_CDP=0 可显式关闭(优先级最高,绕过 settings 开关)
//   - 设置 EA_CDP=1 可临时开启(优先级最高,绕过 settings 开关)
const _eaCdpEnv = process.env.EA_CDP
const _enableCdp =
  _eaCdpEnv === '1' ||
  (_eaCdpEnv !== '0' && settingsService.getSettings().general.remoteMaintenance === true)
if (_enableCdp) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-allow-origins', '*')
  // 打开主进程 Node.js Inspector,挂在 9230 端口(主进程 console.log 可被外部抓取)
  // electron 本身已内置,只需要传 --inspect=9230
  process.argv.push(`--inspect=9230`)
  const source = _eaCdpEnv === '1' ? 'env EA_CDP=1' : 'settings.general.remoteMaintenance=true'
  console.log(
    `[Main] CDP enabled (${source}): renderer @ http://127.0.0.1:9222  main @ ws://127.0.0.1:9230`,
  )
  console.log(
    '[Main] Inspect via Chrome DevTools: chrome://inspect → Configure → add localhost:9222',
  )
  console.log(
    '[Main] To disable: set EA_CDP=0 env var before launch, or toggle off in Settings → General → 远程维修模式',
  )
}

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
      event.preventDefault()
      dialog
        .showMessageBox(win, {
          type: 'question',
          title: '关闭窗口',
          message: '您希望如何处理？',
          buttons: ['最小化到托盘', '直接退出', '取消'],
          defaultId: 0,
          cancelId: 2,
          checkboxLabel: '记住选择',
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
    title: 'Education Advisor',
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
