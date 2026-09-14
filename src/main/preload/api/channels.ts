// =============================================================
// Preload API — 消息频道域(连接中心)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const channelsApi = {
  // [r] 渠道目录 + 实例状态(manifest/五态/开关,卡片墙数据源)
  list: () => ipcInvoke(IPC.IPC_CHANNELS_LIST),
  // [w] 启动渠道(需已配置)
  start: (id: string) => ipcInvoke(IPC.IPC_CHANNELS_START, id),
  // [w] 停止渠道
  stop: (id: string) => ipcInvoke(IPC.IPC_CHANNELS_STOP, id),
  // [w] 测试连接(凭证校验,不建长连接)
  test: (id: string) => ipcInvoke(IPC.IPC_CHANNELS_TEST, id),
  // [r] 订阅渠道状态变化(返回取消订阅函数)
  onStatusUpdate: (callback: (info: unknown) => void) =>
    subscribe(IPC.IPC_CHANNELS_STATUS_UPDATE, callback),
  beginLogin: (id: string) => ipcInvoke(IPC.IPC_CHANNELS_BEGIN_LOGIN, id),
  pollLogin: (loginId: string) => ipcInvoke(IPC.IPC_CHANNELS_POLL_LOGIN, loginId),
  cancelLogin: (loginId: string) => ipcInvoke(IPC.IPC_CHANNELS_CANCEL_LOGIN, loginId),
}
