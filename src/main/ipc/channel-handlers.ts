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
import { Notification } from 'electron'
import { createDingtalkAdapter } from '../services/channels/adapters/dingtalk'
import { createFeishuAdapter } from '../services/channels/adapters/feishu'
import { createWecomAdapter } from '../services/channels/adapters/wecom'
import { createWeixinAdapter } from '../services/channels/adapters/weixin'
import { createQqAdapter } from '../services/channels/adapters/qq'
import { createEmailAdapter } from '../services/channels/adapters/email'
import { createMqttAdapter } from '../services/channels/adapters/mqtt'
import { createYuanbaoAdapter } from '../services/channels/adapters/yuanbao'
import { createXiaoyiAdapter } from '../services/channels/adapters/xiaoyi'
import { channelLoginSessions } from '../services/channels/login/session-manager'
import { buildQwenpawPendingManifests } from '@shared/channel-catalog'
import { channelManager } from '../services/channels/manager'
import { log } from '../utils/logger'
import { sendToRenderer } from './broadcast'
import { handleIpc } from './handle'

/** 注册渠道静态注册表(新渠道在此追加一行;comingSoon 只注册 manifest) */
function registerChannelRegistry(): void {
  channelManager.register(createFeishuAdapter)
  channelManager.register(createDingtalkAdapter)
  channelManager.register(createWecomAdapter)
  channelManager.register(createWeixinAdapter)
  channelManager.register(createQqAdapter)
  channelManager.register(createEmailAdapter)
  channelManager.register(createMqttAdapter)
  channelManager.register(createYuanbaoAdapter)
  channelManager.register(createXiaoyiAdapter)
  // QwenPaw 全量目录占位(「更多」Drawer);已实现 id 不会覆盖 adapters
  for (const manifest of buildQwenpawPendingManifests()) {
    if (channelManager.getAdapter(manifest.id)) continue
    channelManager.registerManifest(manifest)
  }
}

/** 渠道显示名(通知文案用;从 manager manifest 目录取) */
function channelLabel(id: string): string {
  return channelManager.listManifests().find((m) => m.id === id)?.label ?? id
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

  // 扫码登录会话(微信 iLink / QQ 门户 bind)
  handleIpc(IPC.IPC_CHANNELS_BEGIN_LOGIN, async (_e, id: string) => channelLoginSessions.begin(id))
  handleIpc(IPC.IPC_CHANNELS_POLL_LOGIN, async (_e, loginId: string) =>
    channelLoginSessions.poll(loginId),
  )
  handleIpc(IPC.IPC_CHANNELS_CANCEL_LOGIN, async (_e, loginId: string) =>
    channelLoginSessions.cancel(loginId),
  )

  // 状态推送:adapter → Manager 聚合 → renderer + WebUI
  // B6-5(阶段 2 泛化): 渠道转入 error 时弹一次系统通知,
  // 让用户即使不在设置页也能察觉(原 feishu:bot-* 时代的行为平移)
  let lastErrorChannels = new Set<string>()
  channelManager.on('status', (info: ChannelStatusInfo) => {
    try {
      sendToRenderer(win, IPC.IPC_CHANNELS_STATUS_UPDATE, info)
    } catch (err) {
      log('warn', 'channels', `status fanout failed: ${err}`)
    }
    if (info.status === 'error' && !lastErrorChannels.has(info.channel)) {
      lastErrorChannels.add(info.channel)
      try {
        if (Notification.isSupported()) {
          const label = channelLabel(info.channel)
          const n = new Notification({
            title: `${label}连接失败`,
            body: info.detail
              ? `原因: ${String(info.detail).slice(0, 120)}`
              : '请检查凭证与网络后在连接中心重试',
            silent: false,
          })
          n.on('click', () => {
            if (!win.isDestroyed()) win.show()
          })
          n.show()
        }
      } catch {
        /* 通知失败不影响主流程 */
      }
    } else if (info.status !== 'error') {
      lastErrorChannels.delete(info.channel)
    }
  })

  console.log('[IPC] Channel handlers registered')
}
