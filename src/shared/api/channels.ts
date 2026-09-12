// =============================================================
// IPC API 类型 — 消息频道域 (window.api.channels,连接中心)
// 与 preload/api/channels.ts 实现一一对应
// =============================================================

import type { ChannelInstanceInfo, ChannelStatusInfo } from '@shared/types'

export interface ChannelsAPI {
  /** [r] 渠道目录 + 实例状态(卡片墙数据源) */
  list: () => Promise<ChannelInstanceInfo[]>
  /** [w] 启动渠道(需已配置) */
  start: (id: string) => Promise<{ success: boolean; error?: string }>
  /** [w] 停止渠道 */
  stop: (id: string) => Promise<{ success: boolean; error?: string }>
  /** [w] 测试连接(凭证校验,不建长连接) */
  test: (id: string) => Promise<{ ok: boolean; message: string; field?: string }>
  /** [r] 订阅渠道状态变化(返回取消订阅函数) */
  onStatusUpdate: (callback: (info: ChannelStatusInfo) => void) => () => void
}
