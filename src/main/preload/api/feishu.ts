// =============================================================
// Preload API — 飞书集成域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const feishuApi = {
  // [w] 测试连接(返回 token 前 8 位 + 过期秒数) appSecret 从 keystore 读取
  test: (appId: string) => ipcInvoke(IPC.IPC_FEISHU_TEST, appId),
  // [r] 列 bitable 表
  listBitable: (appId: string, appToken: string) =>
    ipcInvoke(IPC.IPC_FEISHU_BITABLE, appId, appToken),
  // [r] 查 token 缓存状态
  status: () => ipcInvoke(IPC.IPC_FEISHU_STATUS),
  // [w] 网络诊断:检测 DNS/HTTPS/鉴权/WebSocket 端点可达性
  diagnose: () => ipcInvoke(IPC.IPC_FEISHU_DIAGNOSE),
}
