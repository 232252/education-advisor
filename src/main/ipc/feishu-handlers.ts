// =============================================================
// Feishu IPC Handlers — 飞书集成 IPC 通道
// feishu:test          测连接(返回 token 前 8 位 + 过期秒数)
// feishu:bitable       列 bitable 表
// feishu:status        返回当前 token 缓存状态
// feishu:bot-start     启动长连接机器人
// feishu:bot-stop      停止长连接机器人
// feishu:bot-status    查询机器人状态
// appSecret 统一从 keystore 读取，不再通过 IPC 参数传递
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { ipcMain, Notification } from 'electron'
import { feishuBotService } from '../services/feishu-bot-service'
import {
  diagnoseConnection,
  type FeishuDomain,
  feishuInfo,
  listBitableTables,
  testConnection,
} from '../services/feishu-service'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { log } from '../utils/logger'

/** 内部辅助：从 keystore 获取飞书 appSecret，获取不到则返回空字符串 */
function getFeishuSecret(): string {
  return keystoreService.getSecret('feishu-app-secret') ?? ''
}

/** 内部辅助：从 settings 读取飞书域名版本(默认国内版 feishu) */
function getFeishuDomain(): FeishuDomain {
  const domain = settingsService.getSettings().feishu.domain
  return domain === 'lark' ? 'lark' : 'feishu'
}

/** M-9 修复: 记录上次注册的 status handler,只移除自己的监听器,不影响外部监听器 */
let prevStatusHandler: ((info: unknown) => void) | null = null

export function registerFeishuHandlers(win: BrowserWindow): void {
  // 机器人状态变化时推送给渲染进程(设置页徽章实时更新)
  // M-9 修复: 只移除自己注册的 listener,不影响外部监听器
  if (prevStatusHandler) {
    feishuBotService.off('status', prevStatusHandler)
  }
  // B6-5 修复: 跟踪上一次状态,仅在转入 error 时弹一次系统通知,避免重复打扰
  let lastBotStatus: string | undefined
  const statusHandler = (info: unknown) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.IPC_FEISHU_BOT_STATUS_UPDATE, info)
    }
    // B6-5: 飞书连接失败时发系统通知,让用户即使不在设置页也能察觉
    const statusInfo = info as { status?: string; error?: string }
    const cur = statusInfo?.status
    if (cur === 'error' && lastBotStatus !== 'error') {
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: '飞书机器人连接失败',
            body: statusInfo?.error
              ? `原因: ${String(statusInfo.error).slice(0, 120)}`
              : '请检查 appId/appSecret 及事件订阅配置',
            silent: false,
          })
          n.on('click', () => {
            if (!win.isDestroyed()) win.show()
          })
          n.show()
        }
      } catch {
        // 通知失败不影响主流程
      }
    }
    lastBotStatus = cur
  }
  prevStatusHandler = statusHandler
  feishuBotService.on('status', statusHandler)

  // H-5 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_FEISHU_TEST, async (_e, appId: string) => {
    if (typeof appId !== 'string' || appId.length === 0) {
      return { success: false, error: 'appId must be a non-empty string' }
    }
    try {
      const appSecret = getFeishuSecret()
      log('info', 'feishu', `test connection, appId=${appId.slice(0, 8)}...`)
      return await testConnection(appId, appSecret, getFeishuDomain())
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] feishu:test failed for "${appId}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-5 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_FEISHU_BITABLE, async (_e, appId: string, appToken: string) => {
    if (typeof appId !== 'string' || typeof appToken !== 'string') {
      return { success: false, error: 'appId and appToken must be strings' }
    }
    try {
      const appSecret = getFeishuSecret()
      log('info', 'feishu', `list bitable tables, appToken=${appToken}`)
      return await listBitableTables(appId, appSecret, appToken, getFeishuDomain())
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] feishu:bitable failed for "${appToken}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-5 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_FEISHU_STATUS, async () => {
    try {
      return feishuInfo()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] feishu:status failed:', msg)
      return { success: false, error: msg }
    }
  })

  // ===== 飿书长连接机器人 =====
  // 启动:从 settings 读 appId + keystore 读 appSecret,启动长连接
  // H-5 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_FEISHU_BOT_START, async () => {
    try {
      const settings = settingsService.getSettings()
      const appId = settings.feishu.appId
      const appSecret = getFeishuSecret()
      if (!appId || !appSecret) {
        return { success: false, error: '请先填写 App ID 和 App Secret 并保存' }
      }
      await feishuBotService.start(appId, appSecret, win, getFeishuDomain())
      const status = feishuBotService.getStatus()
      return { success: status.status === 'connected', status }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] feishu:bot-start failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 停止
  // H-5 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_FEISHU_BOT_STOP, async () => {
    try {
      await feishuBotService.stop()
      return { success: true, status: feishuBotService.getStatus() }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] feishu:bot-stop failed:', msg)
      return { success: false, error: msg, status: feishuBotService.getStatus() }
    }
  })

  // 查询状态
  // H-5 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_FEISHU_BOT_STATUS, async () => {
    try {
      return feishuBotService.getStatus()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] feishu:bot-status failed:', msg)
      return { status: 'unknown', error: msg }
    }
  })

  // 网络诊断:检测 DNS/HTTPS/鉴权/WebSocket 端点,排查远程访问问题
  ipcMain.handle(IPC.IPC_FEISHU_DIAGNOSE, async () => {
    try {
      const settings = settingsService.getSettings()
      const appId = settings.feishu.appId
      const appSecret = getFeishuSecret()
      const domain = getFeishuDomain()
      log(
        'info',
        'feishu',
        `diagnose connection, domain=${domain}, appId=${appId ? `${appId.slice(0, 8)}...` : '(none)'}`,
      )
      return await diagnoseConnection(appId, appSecret, domain)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] feishu:diagnose failed:', msg)
      return {
        steps: [],
        overall: 'fail',
        domain: getFeishuDomain(),
        timestamp: Date.now(),
        error: msg,
      }
    }
  })

  log('info', 'feishu-handlers', 'Feishu IPC handlers registered (appSecret from keystore)')
}
