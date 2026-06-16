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
import { applyDecision, preflightCheck } from '../services/privacy-preflight'
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

  // U-10: 飞书发送前的隐私预检 — 渲染层先调这个拿到 PII 报告,再让用户做决策
  ipcMain.handle(
    IPC.IPC_FEISHU_SEND_PREFLIGHT,
    async (_e, _appId: string, _userOpenId: string, text: string) => {
      // 仅做扫描,不消耗任何 token / 网络
      const report = await preflightCheck(text)
      return report
    },
  )

  // U-10: 飞书发送(带决策守卫) — 默认 block 策略,PII 命中且选 original 时拦截
  ipcMain.handle(
    IPC.IPC_FEISHU_SEND_CONFIRM,
    async (
      _e,
      appId: string,
      userOpenId: string,
      text: string,
      decision: 'cancel' | 'redacted' | 'original' = 'original',
    ) => {
      const report = await preflightCheck(text)
      const guard = applyDecision(report, decision, {
        policy: 'block',
        context: `feishu send to ${userOpenId}`,
      })
      if (!guard.allowed) {
        log('warn', 'feishu', `send blocked: ${guard.error}`)
        return { success: false, error: guard.error, blocked: true, report }
      }
      // guard.text 已是脱敏后(若有)或原文
      const appSecret = getFeishuSecret()
      log(
        'info',
        'feishu',
        `send text to ${userOpenId}, decision=${decision}, pii=${report.hasPII}, len=${guard.text.length}`,
      )
      const result = await sendTextMessage(appId, appSecret, userOpenId, guard.text)
      return { ...result, report, sentTextLength: guard.text.length }
    },
  )

  // 保留旧入口(向后兼容,无预检)。新代码应使用 IPC_FEISHU_SEND_CONFIRM
  ipcMain.handle(
    IPC.IPC_FEISHU_SEND,
    async (_e, appId: string, userOpenId: string, text: string) => {
      const appSecret = getFeishuSecret()
      log('warn', 'feishu', `LEGACY feishu:send used (no preflight), len=${text.length}`)
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
      // U-12: 透传 PII 报告(cron 写入链路 + 手动触发都可见)
      if (result.piiReport?.hasPII) {
        const types = result.piiReport.entities.map((e) => `${e.kind}×${e.count}`).join(', ')
        log(
          'warn',
          'feishu',
          `bitable sync wrote PII (${types}), privacyEnabled=${result.piiReport.privacyEnabled}`,
        )
      }
      return result
    },
  )

  log('info', 'feishu-handlers', 'Feishu IPC handlers registered (appSecret from keystore)')
}
