// =============================================================
// Feishu IPC Handlers — 4 通道
// feishu:test       测连接(返回 token 前 8 位 + 过期秒数)
// feishu:bitable    列 bitable 表
// feishu:send       发文本消息
// feishu:status     返回当前 token 缓存状态
// appSecret 统一从 keystore 读取，不再通过 IPC 参数传递
// =============================================================

import { ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import {
  feishuInfo,
  listBitableTables,
  sendTextMessage,
  syncBitableNow,
  testConnection,
} from '../services/feishu-service'
import { keystoreService } from '../services/keystore-service'
import { log } from '../utils/logger'

/** 内部辅助：从 keystore 获取飞书 appSecret，获取不到则返回空字符串 */
function getFeishuSecret(): string {
  return keystoreService.getSecret('feishu-app-secret') ?? ''
}

export function registerFeishuHandlers(): void {
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

  log('info', 'feishu-handlers', 'Feishu IPC handlers registered (appSecret from keystore)')
}
