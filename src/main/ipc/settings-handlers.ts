// =============================================================
// 设置 IPC 处理器
// 重构 (v2):
//   - minimizeToTray 变化时立即调用 updateTray 实时生效
//   - feishu.appSecret 变化时记录安全警告
//   - telemetry/autoUpdate 等"待实现"字段不报错(让 UI 安静保存)
// =============================================================

import { app, type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { updateTray } from '../services/tray-service'
import { log, setLogLevel } from '../utils/logger'

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

export function registerSettingsHandlers(_win: BrowserWindow) {
  // 启动时同步 autoStart 设置到系统
  const currentSettings = settingsService.getSettings()
  app.setLoginItemSettings({ openAtLogin: currentSettings.general.autoStart })

  ipcMain.handle(IPC.IPC_SETTINGS_GET, async () => {
    const settings = settingsService.getSettings()
    // 如果 keystore 中有飞书 appSecret，用占位符标记（不返回真实密钥）
    if (keystoreService.getSecret('feishu-app-secret')) {
      settings.feishu.appSecret = '__keystore__'
    }
    return settings
  })

  ipcMain.handle(IPC.IPC_SETTINGS_SET, async (_e, path: string, value: unknown) => {
    // 飞书 appSecret:存入 keystore 加密存储，不写入 settings.json
    if (path === 'feishu.appSecret' && typeof value === 'string' && value.length > 0) {
      // 如果是 keystore 占位符，说明用户没修改，跳过
      if (value === '__keystore__') {
        return { success: true }
      }
      keystoreService.setSecret('feishu-app-secret', value)
      log('info', 'settings', 'feishu.appSecret saved to keystore (encrypted)')
      return { success: true }
    }

    // Bug R28-1 修复: 枚举字段校验,拒绝非法值
    const allowedValues = ENUM_VALIDATORS[path]
    if (allowedValues && typeof value === 'string' && !allowedValues.includes(value)) {
      log('warn', 'settings', `Rejected invalid enum value for ${path}: ${value} (allowed: ${allowedValues.join(', ')})`)
      return { success: false, error: `Invalid value "${value}" for ${path}. Allowed: ${allowedValues.join(', ')}` }
    }

    settingsService.update(path, value)

    // 开机启动：同步到系统登录项
    if (path === 'general.autoStart' && typeof value === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: value })
    }

    // 托盘:实时创建/销毁(原版只启动时读一次,改了不生效)
    if (path === 'general.minimizeToTray' && typeof value === 'boolean') {
      updateTray(value)
    }

    // T5: 日志级别:实时切换
    if (path === 'general.logLevel' && typeof value === 'string') {
      setLogLevel(value as 'debug' | 'info' | 'warn' | 'error' | 'off')
      log('info', 'settings', `logLevel changed to ${value}`)
    }

    // T5: 对话日志开关变化
    if (path === 'chat.conversationLogging' && typeof value === 'boolean') {
      log('info', 'settings', `chat.conversationLogging changed to ${value}`)
    }

    return { success: true }
  })

  ipcMain.handle(IPC.IPC_SETTINGS_RESET, async () => {
    settingsService.reset()
    // 重置时也清除 keystore 中的飞书密钥
    keystoreService.deleteSecret('feishu-app-secret')
    // 重置后也要同步 autoStart(默认 false)
    app.setLoginItemSettings({ openAtLogin: false })
    // 重置后也重建托盘
    const newSettings = settingsService.getSettings()
    updateTray(newSettings.general.minimizeToTray)
    // T5: 重置后恢复 logLevel
    setLogLevel(newSettings.general.logLevel)
    log('info', 'settings', `settings reset; logLevel=${newSettings.general.logLevel}`)
    return { success: true }
  })

  console.log('[IPC] Settings handlers registered')
}
