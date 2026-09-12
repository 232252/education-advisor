// =============================================================
// 频道 IPC 处理器(连接中心,M4)
// channels:list/start/stop/test + 状态推送 IPC_CHANNELS_STATUS_UPDATE。
// 全部经 handleIpc 注册进 invokeHandlers → WebUI 网关免费复用(手机浏览器
// 与桌面渲染进程共用同一 IPC 面)。配置保存走既有 settings:set
// (dotPath + 枚举校验 + keystore 占位符协议),不另设 save-config。
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ChannelStatusInfo } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { createDingtalkAdapter } from '../services/channels/adapters/dingtalk'
import { createFeishuAdapter } from '../services/channels/adapters/feishu'
import { channelManager } from '../services/channels/manager'
import { log } from '../utils/logger'
import { sendToRenderer } from './broadcast'
import { handleIpc } from './handle'

/** 注册渠道静态注册表(新渠道在此追加一行;comingSoon 只注册 manifest) */
function registerChannelRegistry(): void {
  channelManager.register(createFeishuAdapter)
  channelManager.register(createDingtalkAdapter)
}

export function registerChannelHandlers(win: BrowserWindow): void {
  registerChannelRegistry()
  channelManager.setWindow(win)

  // [r] 渠道目录 + 实例状态(连接中心卡片墙数据源)
  handleIpc(IPC.IPC_CHANNELS_LIST, async () => channelManager.list())

  // [w] 启动渠道(需已配置;失败抛错由 onError 转结构化消息)
  handleIpc(IPC.IPC_CHANNELS_START, async (_e, id: string) => {
    await channelManager.start(id)
    return { success: true }
  })

  // [w] 停止渠道(排空收尾)
  handleIpc(IPC.IPC_CHANNELS_STOP, async (_e, id: string) => {
    await channelManager.stop(id, { userInitiated: true })
    return { success: true }
  })

  // [w] 测试连接(validateConfig + 显式鉴权,不建长连接)
  handleIpc(IPC.IPC_CHANNELS_TEST, async (_e, id: string) => channelManager.test(id))

  // 状态推送:adapter → Manager 聚合 → renderer + WebUI
  channelManager.on('status', (info: ChannelStatusInfo) => {
    try {
      sendToRenderer(win, IPC.IPC_CHANNELS_STATUS_UPDATE, info)
    } catch (err) {
      log('warn', 'channels', `status fanout failed: ${err}`)
    }
  })

  console.log('[IPC] Channel handlers registered')
}
