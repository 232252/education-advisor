// =============================================================
// App 启动生命周期 — app.whenReady 后的初始化序列
// (协议处理/日志/主题/db/窗口/IPC 注册/cron/飞书自启/托盘/更新检查)
// =============================================================

import path from 'node:path'
import { debug } from '@shared/debug'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { registerAllHandlers } from '../ipc/index'
import { initAutoBackup } from '../services/backup-service'
import { cronService } from '../services/cron-service'
import { dbService } from '../services/db-service'
import { feishuBotService } from '../services/feishu-bot-service'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { syncNativeTheme } from '../services/theme-service'
import { initTray } from '../services/tray-service'
import { updateService } from '../services/update-service'
import { initLogger, log } from '../utils/logger'
import { handleWindowClose } from './close-behavior'
import { mainState } from './state'
import { createMainWindow, resolveAppIcon } from './window'

export async function startApp(): Promise<void> {
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

  const appIcon = resolveAppIcon()

  const win = createMainWindow(appIcon)

  // 启用远程调试(在 app.whenReady 顶部已 appendSwitch,这里只是占位日志)
  mainState.mainWindow = win

  // 注册所有 IPC 处理器（同步注册 + 异步初始化）
  await registerAllHandlers(win)

  // 注册飞书 Bitable 定时同步任务
  cronService.registerBitableSync()

  // M33: 按设置注册定时自动备份 cron 任务(开关开启时挂到 cron 调度,关闭时移除)
  cronService.registerAutoBackup()

  // 启动自动备份调度(每小时检查一次设置,到期则备份并清理旧备份)
  initAutoBackup()

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
  // Linux headless/无托盘环境: new Tray 会抛异常, 捕获后降级为无托盘模式, 不阻塞启动
  try {
    initTray(win)
  } catch (err) {
    console.warn(
      `[Main] Tray init failed, degraded to no-tray mode: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 启动后延迟检查更新（避免启动卡顿）
  // L-6 修复: 保存 timer 引用,退出时清理
  mainState.updateCheckTimer = setTimeout(() => {
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
    mainState.mainWindow = null
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
    if (mainState.mainWindow) {
      mainState.mainWindow.show()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      app.relaunch()
      app.exit(0)
    }
  })
}
