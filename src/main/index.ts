// =============================================================
// Electron 主进程入口
// 技术方向：Electron 33 + Node.js 22
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, net, protocol, shell } from 'electron'
import { debug } from '../shared/debug'
import { registerAllHandlers } from './ipc/index'
import { cronService } from './services/cron-service'
import { dbService } from './services/db-service'
import { feishuBotService } from './services/feishu-bot-service'
import { keystoreService } from './services/keystore-service'
import { ollamaService } from './services/ollama-service'
import { settingsService } from './services/settings-service'
import { destroyTray, getTrayStatus, initTray, resolveIconPath } from './services/tray-service'
import { updateService } from './services/update-service'
import { initLogger, log } from './utils/logger'

// 全局窗口引用
let mainWindow: BrowserWindow | null = null
let isQuitting = false
// L-6 修复: 启动延迟检查更新的 timer 引用,退出时清理避免回调在已销毁的服务上执行
let updateCheckTimer: NodeJS.Timeout | null = null

// 全局未捕获异常处理器 — 防止 Promise 拒绝和未捕获异常静默丢失
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : ''
  console.error('[main] Unhandled rejection:', msg)
  if (stack) console.error(stack)
})
process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught exception:', err.message, err.stack)
})

// P0 修复: 注册 app:// 自定义协议，解决生产模式 file:// 协议下 ES Module CORS 问题
// 必须在 app.whenReady() 之前调用
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// 启用 CDP 远程调试(arch-P0-3 修复: remote-allow-origins 限 localhost 防同网段 RCE)
// 测试阶段默认开启(用户指示: "直接开着吧,真正到要用就是说生产级别的时候再关闭掉")
// 生产环境(packed)强制关闭，无论 ENABLE_CDP 设置如何
// R70 修复: 增加详细诊断日志 + 允许通过 ENABLE_CDP=1 显式强制开启 (即使 isPackaged=true)
console.log(`[Main] CDP check: isPackaged=${app.isPackaged}, ENABLE_CDP=${JSON.stringify(process.env.ENABLE_CDP)}`)
const cdpEnabled = (!app.isPackaged && process.env.ENABLE_CDP !== '0') || process.env.ENABLE_CDP === '1'
if (cdpEnabled) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  app.commandLine.appendSwitch('remote-allow-origins', 'http://localhost:9222')
  console.log('[Main] CDP enabled at http://localhost:9222 (set ENABLE_CDP=0 to disable)')
} else {
  console.log('[Main] CDP disabled (app.isPackaged or ENABLE_CDP=0)')
}

// 启动期输出调试配置状态
if (debug.enabled) {
  console.log('[Main] Debug mode enabled:', {
    eaa: debug.eaa,
    ipc: debug.ipc,
    agent: debug.agent,
    chat: debug.chat,
    cron: debug.cron,
    privacy: debug.privacy,
    render: debug.render,
    logLevel: debug.logLevel,
    cdpPort: debug.cdpPort,
    slowThresholdMs: debug.slowThresholdMs,
  })
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
app
  .whenReady()
  .then(async () => {
    // P0 修复: 注册 app:// 协议处理器，生产模式下通过自定义协议加载渲染进程
    // 解决 file:// 协议下 ES Module CORS 限制
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url)
      // host = 'index' (from app://index/...), pathname = '/index.html' or '/assets/...'
      const filePath = path.join(__dirname, '..', 'renderer', pathname)
      return net.fetch(`file://${filePath}`)
    })

    // T5: 初始化日志系统(从 settings 读 logLevel,劫持 console)
    // DEBUG_LOG_LEVEL 环境变量优先级最高(调试时强制覆盖 settings),否则用 settings.general.logLevel
    const settingsLogLevel = settingsService.getSettings().general.logLevel
    const initialLogLevel = debug.logLevel ?? settingsLogLevel
    initLogger(initialLogLevel)
    log(
      'info',
      'main',
      `Logger initialized at level=${initialLogLevel}${debug.logLevel ? ' (from DEBUG_LOG_LEVEL)' : ''}`,
    )

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
        // P0-2 修复: 启动期断言 preload 存在，支持 .js/.cjs/.mjs 扩展名
        preload: (() => {
          for (const ext of ['.js', '.cjs', '.mjs']) {
            const preloadPath = path.join(__dirname, `preload${ext}`)
            if (fs.existsSync(preloadPath)) return preloadPath
          }
          throw new Error(
            `[Main] preload not found at ${path.join(__dirname, 'preload.*')} — vite build 产物可能改名，` +
              `请确认 vite.config.ts 输出格式与 main 入口一致`,
          )
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

    // 若已配置飞书 appId + appSecret，自动启动长连接机器人
    // 长连接模式无需公网地址，启动后即可在飞书里与机器人对话
    try {
      const s = settingsService.getSettings()
      const secret = keystoreService.getSecret('feishu-app-secret')
      if (s.feishu.appId && secret) {
        feishuBotService.start(s.feishu.appId, secret, win).catch((err) => {
          log('warn', 'main', `feishu bot auto-start failed: ${err}`)
        })
        log('info', 'main', `feishu bot auto-starting, appId=${s.feishu.appId}`)
      }
    } catch (err) {
      log('warn', 'main', `feishu bot auto-start skipped: ${err}`)
    }

    // 外部链接在系统浏览器中打开
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // 读取设置，按需创建系统托盘(委托给 tray-service)
    initTray(win)

    // 启动后延迟检查更新（避免启动卡顿）
    // L-6 修复: 保存 timer 引用,退出时清理
    updateCheckTimer = setTimeout(() => {
      try {
        const s = settingsService.getSettings()
        if (s.general.autoUpdate) {
          updateService
            .checkForUpdates()
            .then(async (info) => {
              if (info.hasUpdate) {
                log('info', 'main', `Update available: v${info.latestVersion}`)
                // MEDIUM 修复: await showUpdateDialog,避免其内部 reject 成为 unhandled rejection
                await updateService.showUpdateDialog()
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
      // P0 修复: 使用自定义 app:// 协议加载渲染进程,解决 file:// 下 ES Module CORS 问题
      win.loadURL('app://index/index.html')
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
  .catch((err) => {
    // 捕获 app.whenReady().then(async () => {...}) 中任何 await 抛出的异常
    console.error(
      '[main] App initialization failed:',
      err instanceof Error ? err.message : String(err),
    )
    if (err instanceof Error && err.stack) console.error(err.stack)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 有托盘时不退出（除非 isQuitting 为 true）
    const { exists: trayExists } = getTrayStatus()
    if (trayExists && !isQuitting) return
    // 真正要退出时才 app.quit()
    // M-4 修复: 异步清理(cron/db/settings/keystore)统一放到 will-quit 中 await,
    // 避免 app.quit() 立即触发导致清理未完成就退出
    app.quit()
  }
})

// 退出前清理托盘
app.on('before-quit', () => {
  isQuitting = true
  // L-6 修复: 清理启动延迟检查更新的 timer,避免回调在已销毁的服务上执行
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer)
    updateCheckTimer = null
  }
  destroyTray()
  // 退出时断开飞书长连接，避免悬挂的 WebSocket
  feishuBotService.stop().catch(() => {})
  // 退出时停止 ollama serve 子进程，避免孤儿进程占用端口
  ollamaService.stopServe()
})

// H-1 修复: 应用退出前 flush settings/keystore 待写数据,避免数据丢失
// M-4 修复: 将 cron/db 的异步清理也放到这里统一 await,避免 window-all-closed 中未 await
// will-quit 在所有窗口关闭后、app 真正退出前触发,适合处理异步清理
// app.exit(0) 不会再次触发 will-quit,因此不会无限循环
app.on('will-quit', (event) => {
  event.preventDefault()
  Promise.all([
    settingsService.flush().catch((err) => {
      log('warn', 'main', `settings flush failed on quit: ${err}`)
    }),
    keystoreService.flush().catch((err) => {
      log('warn', 'main', `keystore flush failed on quit: ${err}`)
    }),
    cronService.shutdown().catch((err) => {
      log('warn', 'main', `cron shutdown failed on quit: ${err}`)
    }),
    dbService.close().catch((err) => {
      log('warn', 'main', `db close failed on quit: ${err}`)
    }),
  ]).finally(() => {
    app.exit(0)
  })
})

// 安全：阻止导航到外部页面
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault()
  })
})
