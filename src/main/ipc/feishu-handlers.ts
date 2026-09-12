// =============================================================
// Feishu IPC Handlers — 飞书出站集成 IPC 通道
// feishu:test          测连接(返回 token 前 8 位 + 过期秒数)
// feishu:bitable       列 bitable 表
// feishu:status        返回当前 token 缓存状态
// feishu:diagnose      网络诊断
// (机器人启停/状态/错误通知已统一走 channels:*(channel-handlers),
//  阶段 2 退役 feishu:bot-* 四条旧通道)
// appSecret 统一从 keystore 读取，不再通过 IPC 参数传递
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { feishuInfo } from '../services/feishu/token'
import {
  diagnoseConnection,
  type FeishuDomain,
  listBitableTables,
  testConnection,
} from '../services/feishu-service'
import { keystoreService } from '../services/keystore-service'
import { settingsService } from '../services/settings-service'
import { log } from '../utils/logger'
import { handleIpc } from './handle'

/** 内部辅助：从 keystore 获取飞书 appSecret，获取不到则返回空字符串 */
function getFeishuSecret(): string {
  return keystoreService.getSecret('feishu-app-secret') ?? ''
}

/** 内部辅助：从 settings 读取飞书域名版本(默认国内版 feishu) */
function getFeishuDomain(): FeishuDomain {
  const domain = settingsService.getSettings().feishu.domain
  return domain === 'lark' ? 'lark' : 'feishu'
}

export function registerFeishuHandlers(_win: BrowserWindow): void {
  // H-5 修复: 加 try-catch
  handleIpc(
    IPC.IPC_FEISHU_TEST,
    async (_e, appId: string) => {
      if (typeof appId !== 'string' || appId.length === 0) {
        return { success: false, error: 'appId must be a non-empty string' }
      }
      const appSecret = getFeishuSecret()
      // 空 secret 不外发: 飞书对空 app_secret 返回 10003 invalid param,
      // 直接给出可操作的提示,而不是让用户面对晦涩的错误码
      if (!appSecret.trim()) {
        return {
          success: false,
          error: 'App Secret 未保存到本地,请先在 App Secret 输入框填写并保存',
        }
      }
      log('info', 'feishu', `test connection, appId=${appId.slice(0, 8)}...`)
      return await testConnection(appId.trim(), appSecret, getFeishuDomain())
    },
    {
      label: (appId: string) => `feishu:test failed for "${appId}"`,
    },
  )

  // ----- status: token 缓存状态(诊断用,不返回 token 本体) -----
  handleIpc(IPC.IPC_FEISHU_STATUS, () => feishuInfo(), {
    label: () => 'feishu:status failed',
  })

  // H-5 修复: 加 try-catch
  handleIpc(
    IPC.IPC_FEISHU_BITABLE,
    async (_e, appId: string, appToken: string) => {
      if (typeof appId !== 'string' || typeof appToken !== 'string') {
        return { success: false, error: 'appId and appToken must be strings' }
      }
      const appSecret = getFeishuSecret()
      log('info', 'feishu', `list bitable tables, appToken=${appToken}`)
      return await listBitableTables(appId, appSecret, appToken, getFeishuDomain())
    },
    {
      label: (_appId: string, appToken: string) => `feishu:bitable failed for "${appToken}"`,
    },
  )

  // 网络诊断:检测 DNS/HTTPS/鉴权/WebSocket 端点,排查远程访问问题
  handleIpc(
    IPC.IPC_FEISHU_DIAGNOSE,
    async () => {
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
    },
    (msg) => ({
      steps: [],
      overall: 'fail',
      domain: getFeishuDomain(),
      timestamp: Date.now(),
      error: msg,
    }),
  )

  log('info', 'feishu-handlers', 'Feishu IPC handlers registered (appSecret from keystore)')
}
