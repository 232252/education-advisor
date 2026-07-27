// =============================================================
// Feishu IPC Handlers — 飞书集成 IPC 通道
// feishu:test          测连接(返回 token 前 8 位 + 过期秒数)
// feishu:bitable       列 bitable 表
// feishu:send          发文本消息
// feishu:status        返回当前 token 缓存状态
// feishu:sync-now      手动触发一次 bitable 同步
// feishu:bot-start     启动长连接机器人
// feishu:bot-stop      停止长连接机器人
// feishu:bot-status    查询机器人状态
// appSecret 统一从 keystore 读取，不再通过 IPC 参数传递
// =============================================================

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { feishuBotService } from '../services/feishu-bot-service'
import {
  feishuInfo,
  listBitableTables,
  sendTextMessage,
  syncBitableNow,
  testConnection,
} from '../services/feishu-service'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { log } from '../utils/logger'

/** 内部辅助：从 keystore 获取飞书 appSecret，获取不到则返回空字符串 */
function getFeishuSecret(): string {
  return keystoreService.getSecret('feishu-app-secret') ?? ''
}

/** M-9 修复: 记录上次注册的 status handler,只移除自己的监听器,不影响外部监听器 */
let prevStatusHandler: ((info: unknown) => void) | null = null

export function registerFeishuHandlers(win: BrowserWindow): void {
  // 机器人状态变化时推送给渲染进程(设置页徽章实时更新)
  // M-9 修复: 只移除自己注册的 listener,不影响外部监听器
  if (prevStatusHandler) {
    feishuBotService.off('status', prevStatusHandler)
  }
  const statusHandler = (info: unknown) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.IPC_FEISHU_BOT_STATUS_UPDATE, info)
    }
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
      return await testConnection(appId, appSecret)
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
      return await listBitableTables(appId, appSecret, appToken)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] feishu:bitable failed for "${appToken}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-5 修复: 加 try-catch
  ipcMain.handle(
    IPC.IPC_FEISHU_SEND,
    async (_e, appId: string, userOpenId: string, text: string) => {
      if (typeof appId !== 'string' || typeof userOpenId !== 'string' || typeof text !== 'string') {
        return { success: false, error: 'appId, userOpenId, and text must be strings' }
      }
      if (text.length === 0) {
        return { success: false, error: 'text must not be empty' }
      }
      try {
        const appSecret = getFeishuSecret()
        log('info', 'feishu', `send text to ${userOpenId}, len=${text.length}`)
        return await sendTextMessage(appId, appSecret, userOpenId, text)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] feishu:send failed for "${userOpenId}":`, msg)
        return { success: false, error: msg }
      }
    },
  )

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

  // T4: 手动触发一次 bitable 同步(graceful 降级)
  // H-5 修复: 加 try-catch
  ipcMain.handle(
    IPC.IPC_FEISHU_SYNC_NOW,
    async (
      _e,
      appId: string,
      appToken: string,
      tableId: string,
      fields: Record<string, unknown>,
    ) => {
      try {
        const appSecret = getFeishuSecret()
        log('info', 'feishu', `sync-now trigger, appToken=${appToken} tableId=${tableId}`)
        const result = await syncBitableNow(appId, appSecret, appToken, tableId, fields)
        if (result.skipped) {
          log('warn', 'feishu', `bitable sync skipped: ${result.skipped}`)
        } else if (result.success) {
          log('info', 'feishu', `bitable sync ok, recordId=${result.recordId}`)
        } else {
          log('warn', 'feishu', `bitable sync failed: ${result.error}`)
        }
        return result
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] feishu:sync-now failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

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
      await feishuBotService.start(appId, appSecret, win)
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

  log('info', 'feishu-handlers', 'Feishu IPC handlers registered (appSecret from keystore)')
}
