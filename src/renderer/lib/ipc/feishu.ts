// =============================================================
// IPC API 类型 — T7: 飞书集成域 (window.api.feishu)
// appSecret 从 keystore 读取，不再通过参数传递
// =============================================================

import type { FeishuBotStatusInfo } from '@shared/types'

export interface FeishuAPI {
  test: (
    appId: string,
  ) => Promise<{ success: boolean; token?: string; expireSec?: number; error?: string }>
  listBitable: (
    appId: string,
    appToken: string,
  ) => Promise<{
    success: boolean
    tables?: Array<{ table_id: string; name: string }>
    error?: string
  }>
  status: () => Promise<string>
  // 飞书长连接机器人
  botStart: () => Promise<{
    success: boolean
    error?: string
    status?: FeishuBotStatusInfo
  }>
  botStop: () => Promise<{ success: boolean; status?: FeishuBotStatusInfo }>
  botStatus: () => Promise<FeishuBotStatusInfo>
  onBotStatusUpdate: (callback: (info: FeishuBotStatusInfo) => void) => () => void
  diagnose: () => Promise<{
    steps: Array<{
      name: string
      status: 'pass' | 'fail' | 'skip'
      latencyMs?: number
      detail: string
      suggestion?: string
    }>
    overall: 'pass' | 'fail'
    domain: string
    timestamp: number
    error?: string
  }>
}
