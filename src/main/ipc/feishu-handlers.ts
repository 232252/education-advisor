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

export function registerFeishuHandlers(win: BrowserWindow): void {
  // 机器人状态变化时推送给渲染进程(设置页徽章实时更新)
  feishuBotService.on('status', (info) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.IPC_FEISHU_BOT_STATUS_UPDATE, info)
    }
  })

  ipcMain.handle(IPC.IPC_FEISHU_TEST, async (_e, appId: string) => {
    const appSecret = getFeishuSecret()
    log('info', 'feishu', `test connection, appId=${appId.slice(0, 8)}...`)
    return testConnection(appId, appSecret)
  })

  ipcMain.handle(IPC.IPC_FEISHU_BITABLE, async (_e, appId: string, appToken: string) => {
    const appSecret = getFeishuSecret()
    log('info', 'feishu', `list bitable tables, appToken=${appToken}`)
    return listBitableTables(appId, appSecret, appToken)
  })

  ipcMain.handle(
    IPC.IPC_FEISHU_SEND,
    async (_e, appId: string, userOpenId: string, text: string) => {
      const appSecret = getFeishuSecret()
      log('info', 'feishu', `send text to ${userOpenId}, len=${text.length}`)
      return sendTextMessage(appId, appSecret, userOpenId, text)
    },
  )

  ipcMain.handle(IPC.IPC_FEISHU_STATUS, async () => feishuInfo())

  // T4: 手动触发一次 bitable 同步(graceful 降级)
  ipcMain.handle(
    IPC.IPC_FEISHU_SYNC_NOW,
    async (
      _e,
      appId: string,
      appToken: string,
      tableId: string,
      fields: Record<string, unknown>,
    ) => {
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
    },
  )

  // ===== 飿书长连接机器人 =====
  // 启动:从 settings 读 appId + keystore 读 appSecret,启动长连接
  ipcMain.handle(IPC.IPC_FEISHU_BOT_START, async () => {
    const settings = settingsService.getSettings()
    const appId = settings.feishu.appId
    const appSecret = getFeishuSecret()
    if (!appId || !appSecret) {
      return { success: false, error: '请先填写 App ID 和 App Secret 并保存' }
    }
    await feishuBotService.start(appId, appSecret, win)
    const status = feishuBotService.getStatus()
    return { success: status.status === 'connected', status }
  })

  // 停止
  ipcMain.handle(IPC.IPC_FEISHU_BOT_STOP, async () => {
    await feishuBotService.stop()
    return { success: true, status: feishuBotService.getStatus() }
  })

  // 查询状态
  ipcMain.handle(IPC.IPC_FEISHU_BOT_STATUS, async () => feishuBotService.getStatus())

  log('info', 'feishu-handlers', 'Feishu IPC handlers registered (appSecret from keystore)')
}
