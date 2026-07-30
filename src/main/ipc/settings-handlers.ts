// =============================================================
// 设置 IPC 处理器
// 重构 (v2):
//   - minimizeToTray 变化时立即调用 updateTray 实时生效
//   - feishu.appSecret 变化时记录安全警告
//   - telemetry/autoUpdate 等"待实现"字段不报错(让 UI 安静保存)
// =============================================================

import { app, type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { UnifiedSettings } from '../../shared/types'
import { TtlLruCache } from '../services/eaa-cache'
import { feishuBotService } from '../services/feishu-bot-service'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { syncNativeTheme } from '../services/theme-service'
import { updateTray } from '../services/tray-service'
import { log, setLogLevel } from '../utils/logger'

/**
 * PERF: settings:get 响应缓存
 * settings:get 被多个页面/组件在挂载时调用,而 settingsService.getSettings()
 * 内部每次 structuredClone(this.settings) 有 O(n) 开销,且每次都要重查 keystore。
 * 缓存最终响应(含 __keystore__ 占位符),TTL 2s 短缓存,set/reset 后立即失效。
 */
const settingsGetCache = new TtlLruCache<UnifiedSettings>({ ttlMs: 2_000, maxEntries: 4 })

/**
 * 枚举字段校验表 (Bug R28-1 修复)
 * 对 UI 中使用 <select> 组件的字段,限制为合法的枚举值。
 * 防止 settings.set 接受任意字符串(如 "INVALID_THEME_XYZ")导致配置损坏。
 */
const ENUM_VALIDATORS: Record<string, readonly string[]> = {
  'general.theme': ['dark', 'light', 'system'],
  'general.language': ['zh-CN', 'en-US', 'zh', 'en'],
  'general.closeBehavior': ['ask', 'tray', 'exit'],
  'general.logLevel': ['debug', 'info', 'warn', 'error', 'off'],
  'chat.steeringMode': ['all', 'one-at-a-time'],
  'chat.followUpMode': ['all', 'one-at-a-time'],
  'chat.thinkingLevel': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
}

export function registerSettingsHandlers(win: BrowserWindow) {
  // 启动时同步 autoStart 设置到系统
  const currentSettings = settingsService.getSettings()
  app.setLoginItemSettings({ openAtLogin: currentSettings.general.autoStart })

  /**
   * 飞书 appId 或 appSecret 变化后，若两者均已配置则重连长连接机器人；
   * 若 appId 被清空则停止。实现"保存即生效"，无需重启 app。
   */
  const reconnectFeishuBot = async () => {
    // M3 修复: 本函数仅在用户保存 appId/appSecret 时触发,本身就是明确的连接意图,
    // 不再因 userStopped(曾手动点"停止")而跳过 — 此前保存新凭证后机器人不会自动连,
    // 必须再手动点一次"连接"才生效
    const s = settingsService.getSettings()
    const secret = keystoreService.getSecret('feishu-app-secret')
    if (s.feishu.appId && secret) {
      // start 内部已做幂等：若 appId 相同且已连接则跳过
      const feishuDomain = s.feishu.domain === 'lark' ? 'lark' : 'feishu'
      await feishuBotService.start(s.feishu.appId, secret, win, feishuDomain).catch((err) => {
        log('warn', 'settings', `feishu bot reconnect failed: ${err}`)
      })
    } else {
      await feishuBotService.stop().catch(() => {})
    }
  }

  ipcMain.handle(IPC.IPC_SETTINGS_GET, async () => {
    // H-9 修复: 加 try-catch
    try {
      // PERF: 命中缓存直接返回(避免 structuredClone + keystore 查询)
      const cached = settingsGetCache.get('response')
      if (cached) return cached
      const settings = settingsService.getSettings()
      // 如果 keystore 中有飞书 appSecret，用占位符标记（不返回真实密钥）
      if (keystoreService.getSecret('feishu-app-secret')) {
        settings.feishu.appSecret = '__keystore__'
      }
      settingsGetCache.set('response', settings)
      return settings
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] settings:get failed:', msg)
      return { success: false, error: msg }
    }
  })

  // H-9 修复: 加顶层 try-catch,确保任何异常都返回结构化错误
  ipcMain.handle(IPC.IPC_SETTINGS_SET, async (_e, path: string, value: unknown) => {
    try {
      // 飞书 appSecret:存入 keystore 加密存储，不写入 settings.json
      if (path === 'feishu.appSecret' && typeof value === 'string' && value.length > 0) {
        // 如果是 keystore 占位符，说明用户没修改，跳过
        if (value === '__keystore__') {
          return { success: true }
        }
        keystoreService.setSecret('feishu-app-secret', value)
        log('info', 'settings', 'feishu.appSecret saved to keystore (encrypted)')
        // Bug R111-1 修复: appSecret 变化后,settings.get 的缓存必须失效,
        // 否则下次 get 仍返回旧值 (无 __keystore__ 占位符),前端会以为 appSecret 被清空
        settingsGetCache.clear()
        // 保存即重连：appSecret 变了，用新密钥重启长连接
        await reconnectFeishuBot()
        return { success: true }
      }

      // Bug R28-1 修复: 枚举字段校验,拒绝非法值
      const allowedValues = ENUM_VALIDATORS[path]
      if (allowedValues && typeof value === 'string' && !allowedValues.includes(value)) {
        log(
          'warn',
          'settings',
          `Rejected invalid enum value for ${path}: ${value} (allowed: ${allowedValues.join(', ')})`,
        )
        return {
          success: false,
          error: `Invalid value "${value}" for ${path}. Allowed: ${allowedValues.join(', ')}`,
        }
      }

      settingsService.update(path, value)
      // PERF: set 后让 get 缓存失效,下次 get 重新读取最新值
      settingsGetCache.clear()

      // 开机启动：同步到系统登录项
      if (path === 'general.autoStart' && typeof value === 'boolean') {
        app.setLoginItemSettings({ openAtLogin: value })
      }

      // 托盘:实时创建/销毁(原版只启动时读一次,改了不生效)
      if (path === 'general.minimizeToTray' && typeof value === 'boolean') {
        updateTray(value)
      }

      // 飞书 appId 变化：保存即重连长连接(appSecret 从 keystore 读取)
      if (path === 'feishu.appId') {
        await reconnectFeishuBot()
      }

      // T5: 日志级别:实时切换
      if (path === 'general.logLevel' && typeof value === 'string') {
        setLogLevel(value as 'debug' | 'info' | 'warn' | 'error' | 'off')
        log('info', 'settings', `logLevel changed to ${value}`)
      }

      // 适配 Electron 33/36: 主题变化时同步到 nativeTheme,
      // 让原生 UI (托盘菜单/系统对话框) 实时跟随
      if (path === 'general.theme') {
        syncNativeTheme()
      }

      // T5: 对话日志开关变化
      if (path === 'chat.conversationLogging' && typeof value === 'boolean') {
        log('info', 'settings', `chat.conversationLogging changed to ${value}`)
      }

      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] settings:set failed for "${path}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-9 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_SETTINGS_RESET, async () => {
    try {
      settingsService.reset()
      // PERF: reset 后让 get 缓存失效
      settingsGetCache.clear()
      // 重置时也清除 keystore 中的飞书密钥
      keystoreService.deleteSecret('feishu-app-secret')
      // 重置后停止飞书长连接
      await feishuBotService.stop().catch(() => {})
      // 重置后也要同步 autoStart(默认 false)
      app.setLoginItemSettings({ openAtLogin: false })
      // 重置后也要重建托盘
      const newSettings = settingsService.getSettings()
      updateTray(newSettings.general.minimizeToTray)
      // T5: 重置后恢复 logLevel
      setLogLevel(newSettings.general.logLevel)
      // 适配 Electron 33/36: 重置后同步 nativeTheme 到默认主题
      syncNativeTheme()
      log('info', 'settings', `settings reset; logLevel=${newSettings.general.logLevel}`)
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] settings:reset failed:', msg)
      return { success: false, error: msg }
    }
  })

  console.log('[IPC] Settings handlers registered')
}
