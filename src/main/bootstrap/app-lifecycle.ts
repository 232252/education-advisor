// =============================================================
// App 启动生命周期 — app.whenReady 后的初始化序列
// (协议处理/日志/主题/db/窗口/IPC 注册/cron/飞书自启/托盘/更新检查)
// =============================================================

import { debug } from '@shared/debug'
import { app, BrowserWindow } from 'electron'
import { registerAllHandlers } from '../ipc/index'
import { initAutoBackup } from '../services/backup-service'
import { channelManager } from '../services/channels/manager'
import { cronService } from '../services/cron-service'
import { dbService } from '../services/db-service'
import { configureDshCredentials } from '../services/dsh/provider-patch'
import { configureDshRuntime, resolveDshEntryPath } from '../services/dsh/runtime'
import { ensureActiveEaaToolBridge, stopActiveEaaToolBridge } from '../services/dsh/tool-bridge'
import { keystoreService } from '../services/keystore-service'
import { resolveAppDataDir, resolveEaaDataDir } from '../services/paths'
import { resolveModel } from '../services/pi-ai/model-utils'
import { settingsService } from '../services/settings-service'
import { syncNativeTheme } from '../services/theme-service'
import { initTray, refreshTrayMenu } from '../services/tray-service'
import { updateService } from '../services/update-service'
import { webUiService } from '../services/webui-service'
import { sweepAtomicTmpResidue } from '../utils/atomic-write'
import { errText } from '../utils/err-text'
import { initLogger, log } from '../utils/logger'
import { openExternalUrl } from '../utils/open-external'
import { registerAppProtocol } from './app-protocol'
import { handleWindowClose } from './close-behavior'
import { bootT0, mainState } from './state'
import { createMainWindow, resolveAppIcon } from './window'

/** 启动分段耗时(诊断用): bootT0 起算的毫秒数 */
const sinceBoot = () => Math.round(performance.now() - bootT0)

export async function startApp(): Promise<void> {
  log('info', 'main', `[Startup] whenReady -> startApp at ${sinceBoot()}ms`)
  // P0 修复: 注册 app:// 协议处理器，生产模式下通过自定义协议加载渲染进程
  // 解决 file:// 协议下 ES Module CORS 限制;handler 内含域内路径约束(防 .. 逃逸)
  registerAppProtocol()

  // T5: 初始化日志系统(从 settings 读 logLevel,劫持 console)
  // DEBUG_LOG_LEVEL 环境变量优先级最高(调试时强制覆盖 settings),否则用 settings.general.logLevel
  const settingsLogLevel = settingsService.getSettings().general.logLevel
  const initialLogLevel = debug.logLevel ?? settingsLogLevel
  initLogger(initialLogLevel)

  // 原子写残留清扫(2026-09-05 根因修复): 崩溃遗留的 *.tmp.<pid>.<ts>.<rand>
  // boot 期一次性执行,异步不阻塞启动;覆盖三个 atomicWrite 落盘根
  void sweepAtomicTmpResidue([
    app.getPath('userData'),
    resolveAppDataDir(),
    resolveEaaDataDir(),
  ]).then((n) => {
    if (n > 0) log('info', 'main', `[Startup] swept ${n} atomic-write tmp residue files`)
  })
  // dsh 子进程的工作目录(session log 落点)。services 层不 import electron,
  // 因此在这里注入 userData,而不是让 dsh/runtime 去依赖 electron。
  // dshBin 同样必须在这里注入：打包态主进程在 app.asar 内,而 SDK 起的纯 node
  // 子进程读不到归档,只能给它归档外(app.asar.unpacked)的真实路径。
  const dshBin = resolveDshEntryPath(app.getAppPath())
  configureDshRuntime({
    cwd: app.getPath('userData'),
    dshBin,
    // patch 里钉住的那条路由要带 models 条目，模型字段以 app 的 pi 目录为准
    routeModel: (route, modelId) => resolveModel(route, modelId),
  })
  if (!dshBin) {
    log(
      'warn',
      'main',
      '[Startup] 未能定位 dsh 子进程入口(@deepseek-ai/dsh 未随包解出?)——dsh 后端的 AI 调用会失败',
    )
  }
  // dsh 子进程的凭据来源：app 存的 provider key 经 subprocess 环境注入，
  // 这样切到 dsh 后端不必让用户再去 dsh 自己的配置里填一遍 key。
  // key 与改名表都以函数注入：dsh/* 模块图不能静态依赖 electron（单测跑在 node 里）。
  configureDshCredentials({
    listProviders: () => keystoreService.listProviders(),
    getApiKey: (providerId) => keystoreService.getApiKey(providerId),
    dshRoutes: () => settingsService.getSettings().models?.dshRoutes,
    // 路由级覆盖的来源：自定义 Base URL、retry.*、cacheRetention、自定义模型列表。
    // 不注入的话 dsh 子进程只带 apiKeyEnv，用户配的网关会被静默忽略。
    modelsSettings: () => settingsService.getSettings().models,
  })
  // 只有 dsh 后端需要工具桥：把 app 的 eaa 工具经 MCP streamable-http 暴露给
  // dsh 子进程（SDK 本身没有注册工具的入口）。缺省 pi 后端时完全不起服务。
  // 这里只起监听、不挂任何端点 —— 每次 agent 运行按该角色工具集挂一个端点。
  if (settingsService.getSettings().models?.agentRuntime !== 'pi') {
    try {
      const bridge = await ensureActiveEaaToolBridge({ patchDir: app.getPath('userData') })
      // 只记端口：token 在 patch 文件里，不进日志
      log('info', 'main', `[Startup] eaa 工具桥已就绪 :${bridge.port}（端点按 agent 运行挂载）`)
    } catch (err) {
      log('error', 'main', `[Startup] eaa 工具桥启动失败: ${errText(err)}`)
    }
  }
  // 运行中把后端从 pi 切到 dsh 时，桥由 execution 按需起；这里统一负责收尾
  app.once('before-quit', () => {
    void stopActiveEaaToolBridge()
  })
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
  // P1-6(09-13 深查 A7): 兜底 — 此前此处抛错会让 startApp 中断,窗口已创建
  // 但永不 loadURL(白窗无恢复);现在记日志后继续加载渲染层(核心对话仍可用)
  try {
    await registerAllHandlers(win)
  } catch (err) {
    log('error', 'main', `[Startup] registerAllHandlers failed (degraded): ${errText(err)}`)
  }

  // R2+(2026-08-28 流畅度审计): loadURL 提前 — handler 注册完成即加载渲染层,
  // cron/飞书/托盘/更新检查改在首帧之后初始化,EAA doctor 已后台预热
  // 外部链接在系统浏览器中打开(https/mailto 白名单,其余协议拒绝)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url)
    return { action: 'deny' }
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
  // P1-4(09-13 深查 A5): 此前仅记日志 — 渲染进程崩溃后白屏,只能手动重启。
  // 现在自动 reload,限 3 次/本次启动防崩溃循环;超限保留日志等用户处理。
  // 09-13 13:40 renderer ErrorBoundary 连环错误实证渲染层确实会坏。
  let rendererReloadCount = 0
  const RENDERER_MAX_AUTO_RELOAD = 3
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Renderer] Process gone: ${details.reason} (exitCode=${details.exitCode})`)
    if (details.reason === 'clean-exit') return
    if (rendererReloadCount >= RENDERER_MAX_AUTO_RELOAD) {
      log(
        'error',
        'main',
        `[Renderer] Auto-reload limit reached (${rendererReloadCount}), giving up — please restart the app`,
      )
      return
    }
    rendererReloadCount++
    log('warn', 'main', `[Renderer] Auto-reload ${rendererReloadCount}/${RENDERER_MAX_AUTO_RELOAD}`)
    setTimeout(() => {
      try {
        win.webContents.reload()
      } catch (err) {
        log('warn', 'main', `[Renderer] Auto-reload failed: ${errText(err)}`)
      }
    }, 500)
  })

  // 监听页面加载失败
  // P1-4(09-13 深查 A6): 此前仅记日志 — app:// 加载失败即白屏。
  // 现在: 主帧失败(忽略 -3 ABORTED 重载竞态) → 1s 后重试一次;
  // 再失败 → data: URL 兜底页(给出可读指引,不再是纯白屏)。
  let loadRetryDone = false
  win.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL, isMainFrame) => {
    log(
      'error',
      'main',
      `[Renderer] Load failed: ${errorCode} ${errorDesc} URL=${validatedURL} mainFrame=${isMainFrame}`,
    )
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED: reload 竞态 */) return
    if (loadRetryDone) {
      const fallbackHtml =
        'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<html><body style="font-family:system-ui;background:#111418;color:#e6e6e6;' +
            'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
            '<div style="text-align:center;max-width:420px">' +
            '<h2 style="margin:0 0 12px">页面加载失败</h2>' +
            '<p style="color:#9aa0a6;line-height:1.6">界面资源加载连续失败。<br/>' +
            '请关闭应用后重新启动;若反复出现,请查看日志目录下的 main-*.log。</p>' +
            '</div></body></html>',
        )
      win.loadURL(fallbackHtml).catch(() => {})
      return
    }
    loadRetryDone = true
    setTimeout(() => {
      log('warn', 'main', '[Renderer] Retrying loadURL after did-fail-load')
      const target =
        process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL
          ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
          : 'app://index/index.html'
      win.loadURL(target).catch(() => {})
    }, 1000)
  })

  // 初始化完成后显示窗口
  win.once('ready-to-show', () => {
    log('info', 'main', `[Startup] ready-to-show at ${sinceBoot()}ms`)
    // 双重保险: 在 show 前再次设置图标,确保 Windows 任务栏正确显示
    if (appIcon) win.setIcon(appIcon)
    win.show()
  })

  // 注册飞书 Bitable 定时同步任务
  cronService.registerBitableSync()

  // M33: 按设置注册定时自动备份 cron 任务(开关开启时挂到 cron 调度,关闭时移除)
  cronService.registerAutoBackup()

  // 启动自动备份调度(每小时检查一次设置,到期则备份并清理旧备份)
  initAutoBackup()

  // M4: 已配置且开关打开的消息频道自动启动(飞书长连接,无需公网地址)
  // 经 ChannelManager 统一链路(注册表/状态聚合/五态派生)
  try {
    channelManager.setWindow(win)
    await channelManager.autoStart()
  } catch (err) {
    log('warn', 'main', `channels auto-start skipped: ${err}`)
  }

  // 读取设置，按需创建系统托盘(委托给 tray-service)
  // Linux headless/无托盘环境: new Tray 会抛异常, 捕获后降级为无托盘模式, 不阻塞启动
  try {
    initTray(win)
  } catch (err) {
    console.warn(`[Main] Tray init failed, degraded to no-tray mode: ${errText(err)}`)
  }

  webUiService.setStatusListener(() => {
    try {
      refreshTrayMenu()
    } catch {
      /* tray 可能未创建 */
    }
  })
  void webUiService.init()

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

  app.on('activate', () => {
    if (mainState.mainWindow) {
      mainState.mainWindow.show()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      app.relaunch()
      app.exit(0)
    }
  })
}
