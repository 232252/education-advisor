// =============================================================
// Preload API — 飞书集成域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const feishuApi = {
  // [w] 测试连接(返回 token 前 8 位 + 过期秒数) appSecret 从 keystore 读取
  test: (appId: string) => ipcInvoke(IPC.IPC_FEISHU_TEST, appId),
  // [r] 列 bitable 表
  listBitable: (appId: string, appToken: string) =>
    ipcInvoke(IPC.IPC_FEISHU_BITABLE, appId, appToken),
  // [r] 查 token 缓存状态
  status: () => ipcInvoke(IPC.IPC_FEISHU_STATUS),
  // ===== 飿书长连接机器人 =====
  // [w] 启动长连接(appId 从 settings 读, appSecret 从 keystore 读)
  botStart: () => ipcInvoke(IPC.IPC_FEISHU_BOT_START),
  // [w] 停止长连接
  botStop: () => ipcInvoke(IPC.IPC_FEISHU_BOT_STOP),
  // [r] 查询机器人当前状态
  botStatus: () => ipcInvoke(IPC.IPC_FEISHU_BOT_STATUS),
  // [r] 订阅机器人状态变化(返回取消订阅函数)
  onBotStatusUpdate: (callback: (info: unknown) => void) =>
    subscribe(IPC.IPC_FEISHU_BOT_STATUS_UPDATE, callback),
  // [w] 网络诊断:检测 DNS/HTTPS/鉴权/WebSocket 端点可达性
  diagnose: () => ipcInvoke(IPC.IPC_FEISHU_DIAGNOSE),
}
