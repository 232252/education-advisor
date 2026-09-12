// =============================================================
// 设置 IPC 处理器
// 重构 (v2):
//   - minimizeToTray 变化时立即调用 updateTray 实时生效
//   - feishu.appSecret 变化时记录安全警告
//   - telemetry/autoUpdate 等"待实现"字段不报错(让 UI 安静保存)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { UnifiedSettings } from '@shared/types'
import { app, type BrowserWindow } from 'electron'
import { channelManager } from '../services/channels/manager'
import { cronService } from '../services/cron-service'
import { TtlLruCache } from '../services/eaa-cache'
import { feishuBotService } from '../services/channels/adapters/feishu/connection'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { syncNativeTheme } from '../services/theme-service'
import { updateTray } from '../services/tray-service'
import { parseHhMm } from '../services/webui/schedule'
import { LEGACY_CF_TUNNEL_SECRET_KEY, WEBUI_ACCESS_TOKEN_KEY } from '../services/webui/security'
import { webUiService } from '../services/webui-service'
import { log, setLogLevel } from '../utils/logger'
import { handleIpc } from './handle'

/**
 * PERF: settings:get 响应缓存
 * settings:get 被多个页面/组件在挂载时调用,而 settingsService.getSettings()
 * 内部每次 structuredClone(this.settings) 有 O(n) 开销,且每次都要重查 keystore。
 * 缓存最终响应(含 __keystore__ 占位符),TTL 2s 短缓存,set/reset 后立即失效。
 */
const settingsGetCache = new TtlLruCache<UnifiedSettings>({ ttlMs: 2_000, maxEntries: 4 })

/** keystore 回显占位符: secret 永不离开本机,界面只显示"已加密保存" */
const SECRET_PLACEHOLDER = '__keystore__'

/** 出厂重置后让 settings:get 不再返回旧快照 */
export function invalidateSettingsGetCache(): void {
  settingsGetCache.clear()
}

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
  'general.webUiMode': ['off', 'always', 'scheduled'],
  'general.webUiProtocol': ['http', 'https'],
  'general.webUiBind': ['loopback', 'lan', 'all'],
  'chat.steeringMode': ['all', 'one-at-a-time'],
  'chat.followUpMode': ['all', 'one-at-a-time'],
  'chat.thinkingLevel': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'channels.feishu.domain': ['feishu', 'lark'],
}

export function registerSettingsHandlers(win: BrowserWindow) {
  // 启动时同步 autoStart 设置到系统
  const currentSettings = settingsService.getSettings()
  app.setLoginItemSettings({ openAtLogin: currentSettings.general.autoStart })

  /**
   * 飞书频道凭证/开关变化后按需重连(保存即生效,无需重启 app)。
   * M4: 经 ChannelManager 走统一频道链路(凭证读 channels.feishu + keystore);
   * 旧路径(feishu.appId)保存时已镜像到 channels.feishu,同样收敛到这里。
   */
  const reconnectFeishuBot = async () => {
    // M3 修复: 本函数仅在用户保存 appId/appSecret/开关时触发,本身就是明确的连接意图,
    // 不再因 userStopped(曾手动点"停止")而跳过 — 此前保存新凭证后机器人不会自动连,
    // 必须再手动点一次"连接"才生效
    const s = settingsService.getSettings()
    const secret = keystoreService.getSecret('feishu-app-secret')
    if (s.channels.feishu.enabled && s.channels.feishu.appId && secret) {
      await channelManager.start('feishu').catch((err) => {
        log('warn', 'settings', `feishu channel reconnect failed: ${err}`)
      })
    } else {
      await channelManager.stop('feishu').catch(() => {})
    }
  }

  /**
   * 钉钉频道凭证/开关变化后按需重连(与飞书同款语义,阶段 2)。
   */
  const reconnectDingtalkBot = async () => {
    const s = settingsService.getSettings()
    const secret = keystoreService.getSecret('dingtalk-client-secret')
    if (s.channels.dingtalk.enabled && s.channels.dingtalk.clientId && secret) {
      await channelManager.start('dingtalk').catch((err) => {
        log('warn', 'settings', `dingtalk channel reconnect failed: ${err}`)
      })
    } else {
      await channelManager.stop('dingtalk').catch(() => {})
    }
  }

  // H-9 修复: 加 try-catch
  handleIpc(IPC.IPC_SETTINGS_GET, async () => {
    // PERF: 命中缓存直接返回(避免 structuredClone + keystore 查询)
    const cached = settingsGetCache.get('response')
    if (cached) return cached
    const settings = settingsService.getSettings()
    // 如果 keystore 中有飞书 appSecret，用占位符标记（不返回真实密钥）
    if (keystoreService.getSecret('feishu-app-secret')) {
      settings.feishu.appSecret = SECRET_PLACEHOLDER
      settings.channels.feishu.appSecret = SECRET_PLACEHOLDER
    }
    if (keystoreService.getSecret('dingtalk-client-secret')) {
      settings.channels.dingtalk.clientSecret = SECRET_PLACEHOLDER
    }
    settingsGetCache.set('response', settings)
    return settings
  })

  // H-9 修复: 加顶层 try-catch,确保任何异常都返回结构化错误
  handleIpc(
    IPC.IPC_SETTINGS_SET,
    async (_e, path: string, value: unknown) => {
      // 飞书凭据统一去首尾空白: 粘贴带入的空格/换行会让飞书返回
      // 10003(appId/secret 为空或含空白)或 10014(secret 含空白),保存前先归一化
      // 钉钉同理(Stream 建连对凭证空白敏感)
      if (
        typeof value === 'string' &&
        (path === 'feishu.appId' ||
          path === 'feishu.appSecret' ||
          path === 'channels.feishu.appId' ||
          path === 'channels.feishu.appSecret' ||
          path === 'channels.dingtalk.clientId' ||
          path === 'channels.dingtalk.clientSecret')
      ) {
        value = value.trim()
      }

      // 钉钉渠道 secret(阶段 2): 与飞书同一协议 —
      // keystore 加密存储('dingtalk-client-secret'),不写 settings.json;清空 = 删除密钥
      if (path === 'channels.dingtalk.clientSecret' && typeof value === 'string') {
        if (value === SECRET_PLACEHOLDER) {
          return { success: true }
        }
        if (value.length === 0) {
          keystoreService.deleteSecret('dingtalk-client-secret')
          settingsService.update('channels.dingtalk.clientSecret', '')
          settingsGetCache.clear()
          log('info', 'settings', 'channels.dingtalk.clientSecret cleared (empty input)')
          await reconnectDingtalkBot()
          return { success: true }
        }
        keystoreService.setSecret('dingtalk-client-secret', value)
        log('info', 'settings', 'channels.dingtalk.clientSecret saved to keystore (encrypted)')
        settingsGetCache.clear()
        await reconnectDingtalkBot()
        return { success: true }
      }

      // M4: 渠道 secret(channels.feishu.appSecret)与旧路径(feishu.appSecret)
      // 同一协议:keystore 加密存储,不写 settings.json;清空 = 删除密钥
      if (path === 'channels.feishu.appSecret' && typeof value === 'string') {
        if (value === '__keystore__') {
          return { success: true }
        }
        if (value.length === 0) {
          keystoreService.deleteSecret('feishu-app-secret')
          settingsService.update('channels.feishu.appSecret', '')
          settingsGetCache.clear()
          log('info', 'settings', 'channels.feishu.appSecret cleared (empty input)')
          await reconnectFeishuBot()
          return { success: true }
        }
        keystoreService.setSecret('feishu-app-secret', value)
        log('info', 'settings', 'channels.feishu.appSecret saved to keystore (encrypted)')
        settingsGetCache.clear()
        await reconnectFeishuBot()
        return { success: true }
      }
      if (path === 'feishu.appSecret' && typeof value === 'string') {
        // 如果是 keystore 占位符，说明用户没修改，跳过
        if (value === '__keystore__') {
          return { success: true }
        }
        // 清空输入 = 清除 keystore 已存 secret(避免"输入框已空但仍在用旧密钥"的假状态)
        if (value.length === 0) {
          keystoreService.deleteSecret('feishu-app-secret')
          settingsService.update('feishu.appSecret', '')
          settingsGetCache.clear()
          log('info', 'settings', 'feishu.appSecret cleared (empty input)')
          await reconnectFeishuBot()
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

      if (path === 'general.webUiPort') {
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 1024 ||
          value > 65535
        ) {
          return { success: false, error: 'webUiPort must be an integer between 1024 and 65535' }
        }
      }
      if (path === 'general.webUiScheduleStart' || path === 'general.webUiScheduleEnd') {
        if (typeof value !== 'string' || !parseHhMm(value)) {
          return { success: false, error: `${path} must be HH:mm` }
        }
      }
      if (path === 'general.webUiScheduleDays') {
        if (
          !Array.isArray(value) ||
          value.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)
        ) {
          return { success: false, error: 'webUiScheduleDays must be integers 0-6' }
        }
      }
      if (path === 'general.webUiIpv6' && typeof value !== 'boolean') {
        return { success: false, error: 'webUiIpv6 must be boolean' }
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
        // M4 镜像: 旧 UI 路径写入时同步到 channels.feishu(权威位置)
        if (typeof value === 'string') {
          settingsService.update('channels.feishu.appId', value)
          settingsGetCache.clear()
        }
        await reconnectFeishuBot()
      }

      // M4: 新路径(channels.feishu.*)保存即生效 —
      // appId/domain 镜像回 feishu.*(出站集成共用凭证);
      // appId/enabled/allowGroups 变化触发重连(allowGroups 在连接建立时读取)
      if (path === 'channels.feishu.appId' || path === 'channels.feishu.domain') {
        const s = settingsService.getSettings()
        settingsService.update('feishu.appId', s.channels.feishu.appId)
        settingsService.update('feishu.domain', s.channels.feishu.domain)
        settingsGetCache.clear()
        if (path === 'channels.feishu.appId') {
          await reconnectFeishuBot()
        }
      }
      if (
        path === 'channels.feishu.enabled' ||
        path === 'channels.feishu.allowGroups' ||
        path === 'channels.feishu.agentId'
      ) {
        await reconnectFeishuBot()
      }

      // 钉钉渠道(阶段 2): 任一配置变化保存即重连
      // (clientId/secret 直接影响建连;allowGroups/agentId 在 start 时读取;
      //  cardTemplateId 在 start 时定格进引擎凭证)
      if (
        path === 'channels.dingtalk.clientId' ||
        path === 'channels.dingtalk.enabled' ||
        path === 'channels.dingtalk.allowGroups' ||
        path === 'channels.dingtalk.agentId' ||
        path === 'channels.dingtalk.cardTemplateId'
      ) {
        await reconnectDingtalkBot()
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

      // F2 修复: bitableSync 开关/间隔变化后联动 cron 任务(保存即生效,无需重启)。
      // registerBitableSync 已改为幂等 upsert: enabled → 按当前 syncInterval 重建;
      // disabled → 移除既有 __feishu__ 任务。cron-service 不 import 本文件,无循环依赖。
      if (path === 'feishu.bitableSync.enabled' || path === 'feishu.bitableSync.syncInterval') {
        cronService.registerBitableSync()
      }

      // M33: 定时自动备份开关/cron 表达式变化后联动 cron 任务(照抄 bitableSync 联动模式)。
      // registerAutoBackup 幂等 upsert: enabled → 按当前 autoBackupCron 重建(改表达式重绑);
      // disabled → 移除既有 auto-backup 任务(关闭开关任务消失)。
      if (path === 'backup.autoBackupEnabled' || path === 'backup.autoBackupCron') {
        cronService.registerAutoBackup()
      }

      if (
        path === 'general.webUiMode' ||
        path === 'general.webUiPort' ||
        path === 'general.webUiScheduleStart' ||
        path === 'general.webUiScheduleEnd' ||
        path === 'general.webUiScheduleDays' ||
        path === 'general.timezone' ||
        path === 'general.webUiProtocol' ||
        path === 'general.webUiBind' ||
        path === 'general.webUiIpv6' ||
        path === 'general.webUiTlsCertPath' ||
        path === 'general.webUiTlsKeyPath'
      ) {
        void webUiService.syncFromSettings()
      }

      return { success: true }
    },
    {
      onError: (msg) => ({ success: false, error: msg }),
      label: (p: string) => `settings:set failed for "${p}"`,
    },
  )

  // H-9 修复: 加 try-catch
  handleIpc(IPC.IPC_SETTINGS_RESET, async () => {
    settingsService.reset()
    // PERF: reset 后让 get 缓存失效
    settingsGetCache.clear()
    // 重置时也清除 keystore 中的飞书/钉钉密钥
    keystoreService.deleteSecret('feishu-app-secret')
    keystoreService.deleteSecret('dingtalk-client-secret')
    keystoreService.deleteSecret(WEBUI_ACCESS_TOKEN_KEY)
    keystoreService.deleteSecret(LEGACY_CF_TUNNEL_SECRET_KEY)
    // 重置后停止飞书/钉钉长连接
    await feishuBotService.stop().catch(() => {})
    await channelManager.stop('dingtalk').catch(() => {})
    // 重置后也要同步 autoStart(默认 false)
    app.setLoginItemSettings({ openAtLogin: false })
    // 重置后也要重建托盘
    const newSettings = settingsService.getSettings()
    updateTray(newSettings.general.minimizeToTray)
    // T5: 重置后恢复 logLevel
    setLogLevel(newSettings.general.logLevel)
    // 适配 Electron 33/36: 重置后同步 nativeTheme 到默认主题
    syncNativeTheme()
    // F2 修复: 重置后 bitableSync 回到默认关闭,联动移除既有 __feishu__ cron 任务
    cronService.registerBitableSync()
    // M33: 重置后 autoBackupEnabled 回到默认关闭,联动移除既有 auto-backup cron 任务
    cronService.registerAutoBackup()
    void webUiService.syncFromSettings()
    log('info', 'settings', `settings reset; logLevel=${newSettings.general.logLevel}`)
    return { success: true }
  })

  console.log('[IPC] Settings handlers registered')
}
