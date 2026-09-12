// =============================================================
// adapters/dingtalk/manifest — 钉钉渠道占位 manifest(M5「即将支持」卡)
// 事实来源: docs/research/2026-09-12-channel-connector-catalog.md §2.1
// (Stream Mode 出站 WSS 桌面直连 + AI 卡片 streamingUpdate 流式 + 三权限)。
// comingSoon = true:连接中心可见、不可配置;adapter 实现属阶段 2 P0。
// =============================================================

import type { ChannelManifest } from '@shared/types'

export const DINGTALK_MANIFEST_ID = 'dingtalk'

export const dingtalkManifest: ChannelManifest = {
  id: DINGTALK_MANIFEST_ID,
  label: '钉钉机器人',
  description:
    '与飞书同构的 WebSocket 长连接(Stream Mode),无需公网 IP;支持 AI 卡片打字机流式与文件接收(规划中)。',
  icon: 'dingtalk',
  comingSoon: true,
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'card-stream',
    canSendCard: true,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: true,
  },
  configSchema: [
    { name: 'clientId', label: 'Client ID', type: 'string', required: true },
    { name: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
  ],
  setupGuide: {
    title: '钉钉开放平台操作清单(开放后可用)',
    steps: [
      '钉钉开放平台创建企业内部应用,添加「机器人」能力',
      '开通权限 Card.Streaming.Write / Card.Instance.Write / qyapi_robot_sendmsg',
      '消息接收选择「Stream 模式」(无需公网回调)',
      '创建版本并发布,复制 Client ID / Client Secret 到连接中心',
    ],
  },
}
