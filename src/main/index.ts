// =============================================================
// Electron 主进程入口
// 技术方向：Electron 43 + Node.js 24.18 (Chromium 150)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, nativeImage, net, protocol, shell } from 'electron'
import { debug } from '../shared/debug'
import { registerAllHandlers } from './ipc/index'
import { agentService } from './services/agent-service'
import { cronService } from './services/cron-service'
import { dbService } from './services/db-service'
import { eaaBridge } from './services/eaa-bridge'
import { feishuBotService } from './services/feishu-bot-service'
import { keystoreService } from './services/keystore-service'
import { ollamaService } from './services/ollama-service'
import { settingsService } from './services/settings-service'
import { syncNativeTheme } from './services/theme-service'
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
  // Ignore EPIPE errors from broken stdout pipe (common when running as subprocess)
  if (err && (err as Error).message?.includes('EPIPE')) return
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
console.log(
  `[Main] CDP check: isPackaged=${app.isPackaged}, ENABLE_CDP=${JSON.stringify(process.env.ENABLE_CDP)}`,
)
const cdpEnabled =
  (!app.isPackaged && process.env.ENABLE_CDP !== '0') || process.env.ENABLE_CDP === '1'
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
    case 'tray': {
      // 防御: 托盘不存在时(图标缺失或 minimizeToTray 被关闭)不能隐藏窗口,
      // 否则应用会"消失"且无法恢复 — 回退到询问对话框
      const { exists: trayAlive } = getTrayStatus()
      if (trayAlive) {
        event.preventDefault()
        win.hide()
      } else {
        // 托盘不可用,弹出询问对话框
        event.preventDefault()
        showCloseDialog(win)
      }
      break
    }

    case 'exit':
      // B6-1: 若飞书机器人正在运行,退出会断开其长连接(影响"远程访问")。
      // 先同步阻止关闭,再异步确认。
      event.preventDefault()
      confirmQuitIfNeeded(win)
      break

    default: {
      // 同步阻止关闭，然后异步弹对话框
      event.preventDefault()
      showCloseDialog(win)
      break
    }
  }
}

/** 关闭行为询问对话框（closeBehavior='ask' 或托盘不可用时的回退） */
function showCloseDialog(win: BrowserWindow): void {
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
        // 若托盘不可用则直接退出,不能隐藏到不存在的托盘
        const { exists: trayAlive } = getTrayStatus()
        if (trayAlive) {
          win.hide()
        } else {
          isQuitting = true
          app.quit()
        }
      } else {
        isQuitting = true
        app.quit()
      }
    })
    .catch(() => {
      /* dialog cancelled or error */
    })
}

/**
 * B6-1: 真正退出前,若飞书机器人处于连接/连接中状态,弹确认框提醒用户
 * 退出会断开飞书长连接(导致无法再从飞书远程对话)。
 * bot 未运行时直接退出,不打扰用户。
 */
function confirmQuitIfNeeded(win: BrowserWindow): void {
  let botActive = false
  try {
    const st = feishuBotService.getStatus().status
    botActive = st === 'connected' || st === 'connecting'
  } catch {
    botActive = false
  }
  if (!botActive) {
    isQuitting = true
    app.quit()
    return
  }
  dialog
    .showMessageBox(win, {
      type: 'warning',
      title: '飞书机器人正在运行',
      message: '退出应用将断开飞书机器人的长连接，您将无法再从飞书远程对话。',
      buttons: ['最小化到托盘(保持运行)', '仍然退出', '取消'],
      defaultId: 0,
      cancelId: 2,
    })
    .then((result) => {
      if (result.response === 2) return // 取消
      if (result.response === 0) {
        // 最小化到托盘:若托盘可用则隐藏,否则提示无法最小化
        const { exists: trayAlive } = getTrayStatus()
        if (trayAlive) {
          win.hide()
        } else {
          dialog.showMessageBox(win, {
            type: 'info',
            message: '当前未启用托盘图标，无法最小化到后台。已在“设置”中为您启用最小化到托盘。',
            buttons: ['知道了'],
          })
          settingsService.update('general.minimizeToTray', true)
        }
      } else {
        isQuitting = true
        app.quit()
      }
    })
    .catch(() => {
      /* dialog cancelled */
    })
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

    // 适配 Electron 39/40: 记录硬件加速状态,便于诊断渲染/性能问题
    // app.isHardwareAccelerationEnabled() 在 E39 引入,做防御性检测兼容旧版。
    // 类型断言:已安装的 electron 类型(E33)可能尚未声明该方法,运行时用 typeof 守卫。
    const appWithHwAccel = app as typeof app & { isHardwareAccelerationEnabled?: () => boolean }
    if (typeof appWithHwAccel.isHardwareAccelerationEnabled === 'function') {
      log(
        'info',
        'main',
        `Hardware acceleration: ${appWithHwAccel.isHardwareAccelerationEnabled() ? 'enabled' : 'disabled'}`,
      )
    }

    // 适配 Electron 33/36: 同步 settings.general.theme 到 nativeTheme,
    // 让原生 UI (托盘菜单/系统对话框) 明暗跟随 app 设置
    syncNativeTheme()

    // P2-4: 初始化 SQLite,失败不阻塞主流程
    await dbService.init()

    const iconPath = resolveIconPath()
    if (!iconPath) {
      console.warn('[Main] No icon found, using Electron default')
    }
    // 清晰度优化: 直接传 ICO 路径(而非 NativeImage), Windows 会保留 ICO 内全部尺寸帧
    // (16/24/32/48/64/128/256), 标题栏/任务栏/Alt-Tab 各场景自动选最佳帧, 不再整体缩放。
    // ICO 缺失时回退 PNG NativeImage。
    let appIcon: string | Electron.NativeImage | undefined
    if (iconPath) {
      if (iconPath.toLowerCase().endsWith('.ico')) {
        appIcon = iconPath
        console.log(`[Main] Window icon: ${iconPath} (multi-frame ICO)`)
      } else {
        appIcon = nativeImage.createFromPath(iconPath)
        console.log(
          `[Main] Window icon: ${iconPath} (${appIcon.getSize().width}x${appIcon.getSize().height})`,
        )
        if (appIcon.isEmpty()) {
          console.warn('[Main] Icon loaded but empty, falling back to default')
          appIcon = undefined
        }
      }
    }

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      title: 'Education Advisor',
      ...(appIcon ? { icon: appIcon } : {}),
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
        const feishuDomain = s.feishu.domain === 'lark' ? 'lark' : 'feishu'
        feishuBotService.start(s.feishu.appId, secret, win, feishuDomain).catch((err) => {
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
      // 双重保险: 在 show 前再次设置图标,确保 Windows 任务栏正确显示
      if (appIcon) win.setIcon(appIcon)
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
  // P1-10: 终止 in-flight EAA 子进程 + 清空读缓存 + 清空隐私密码
  // 同步操作, 放在 before-quit 避免阻塞 will-quit 的异步清理链
  eaaBridge.shutdown()
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
    // P1-10: 优雅关闭 agent 服务(abort 运行中的 agent + 销毁 MCP 连接)
    // 内部含 5 秒超时, 不会阻塞退出
    agentService.shutdown().catch((err) => {
      log('warn', 'main', `agent service shutdown failed on quit: ${err}`)
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
