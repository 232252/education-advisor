// =============================================================
// Electron 主进程入口
// 技术方向：Electron 43 + Node.js 24.18 (Chromium 150)
// 启动接线拆分到 ./bootstrap/:
//   - state.ts         共享状态(窗口引用/退出标记/更新 timer)
//   - window.ts        应用图标解析 + 主窗口创建
//   - close-behavior.ts 关闭行为(tray/exit/ask + 飞书退出确认)
//   - app-lifecycle.ts whenReady 后的初始化序列(startApp)
// =============================================================

import { debug } from '@shared/debug'
import { app, protocol } from 'electron'
import { startApp } from './bootstrap/app-lifecycle'
import { mainState } from './bootstrap/state'
import { agentService } from './services/agent-service'
import { shutdownAutoBackup } from './services/backup-service'
import { feishuBotService } from './services/channels/adapters/feishu/connection'
import { cronService } from './services/cron-service'
import { dbService } from './services/db-service'
import { eaaBridge } from './services/eaa-bridge'
import { keystoreService } from './services/keystore-service'
import { ollamaService } from './services/ollama-service'
import { settingsService } from './services/settings-service'
import { destroyTray, getTrayStatus } from './services/tray-service'
import { webUiService } from './services/webui-service'
import { errText } from './utils/err-text'
import { loadDevEnv } from './utils/load-dev-env'
import { log } from './utils/logger'

// 开发模式 .env 加载 — 必须在读取 ENABLE_CDP/DEBUG_* 等环境变量之前执行
// (此前 .env 文件从不被主进程解析,拷贝后不生效,需手动 export)
const devEnvLoaded = loadDevEnv()
if (devEnvLoaded > 0) {
  console.log(`[Main] Loaded ${devEnvLoaded} entries from .env (dev mode)`)
}

// 全局未捕获异常处理器 — 防止 Promise 拒绝和未捕获异常静默丢失
process.on('unhandledRejection', (reason) => {
  const msg = errText(reason)
  const stack = reason instanceof Error ? reason.stack : ''
  console.error('[main] Unhandled rejection:', msg)
  if (stack) console.error(stack)
})
process.on('uncaughtException', (err) => {
  // Ignore EPIPE errors from broken stdout pipe (common when running as subprocess)
  if (err && (err as Error).message?.includes('EPIPE')) return
  console.error('[main] Uncaught exception:', err.message, err.stack)
})

// Windows 任务栏图标/右键跳转列表修复: 设置 AppUserModelID
// 未设置时 Windows 以进程 exe 路径作为 AUMID, 开发模式下 electron.exe
// 会被识别为 "Electron" 并显示默认图标分组
app.setAppUserModelId('com.education-advisor.app')

// 启动提速(2026-09-04): DB 初始化是纯 fs/SQLite 操作,不依赖 app.whenReady —
// 在此提前开跑,与 Chromium 引导期并行,把 openDatabase/建表/预编译的耗时
// 完全移出首帧关键路径(startApp 中的 await 直取同一 in-flight Promise)
void dbService.init()

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
  // 端口可通过 EA_CDP_PORT 覆盖(默认 9222),避免与本机其他 CDP 实例冲突
  const cdpPort = process.env.EA_CDP_PORT || '9222'
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort)
  app.commandLine.appendSwitch('remote-allow-origins', `http://localhost:${cdpPort}`)
  console.log(`[Main] CDP enabled at http://localhost:${cdpPort} (set ENABLE_CDP=0 to disable)`)
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
// App 生命周期
// =============================================================
app
  .whenReady()
  .then(() => startApp())
  .catch((err) => {
    // 捕获 app.whenReady().then(async () => {...}) 中任何 await 抛出的异常
    console.error('[main] App initialization failed:', errText(err))
    if (err instanceof Error && err.stack) console.error(err.stack)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 有托盘时不退出（除非 isQuitting 为 true）
    const { exists: trayExists } = getTrayStatus()
    if (trayExists && !mainState.isQuitting) return
    // 真正要退出时才 app.quit()
    // M-4 修复: 异步清理(cron/db/settings/keystore)统一放到 will-quit 中 await,
    // 避免 app.quit() 立即触发导致清理未完成就退出
    app.quit()
  }
})

// 退出前清理托盘
app.on('before-quit', () => {
  mainState.isQuitting = true
  // L-6 修复: 清理启动延迟检查更新的 timer,避免回调在已销毁的服务上执行
  if (mainState.updateCheckTimer) {
    clearTimeout(mainState.updateCheckTimer)
    mainState.updateCheckTimer = null
  }
  destroyTray()
  // 停止自动备份调度,避免退出过程中触发备份
  shutdownAutoBackup()
  // 退出时断开飞书长连接，避免悬挂的 WebSocket
  feishuBotService.stop().catch(() => {})
  // 退出时停止 ollama serve 子进程，避免孤儿进程占用端口
  ollamaService.stopServe()
  // P1-10: 终止 in-flight EAA 子进程 + 清空读缓存 + 清空隐私密码
  // 同步操作, 放在 before-quit 避免阻塞 will-quit 的异步清理链
  eaaBridge.shutdown()
  void webUiService.shutdown()
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

// 安全：阻止导航到外部页面;权限白名单 — 仅剪贴板读写放行
// (ContextMenu 复制/粘贴与各处复制按钮依赖),其余(地理/通知/媒体等)
// 一律拒绝: 应用无此类需求,防渲染内容静默申请高权限 API
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  contents.session.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  )
})
