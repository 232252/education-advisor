import type { ChannelManifest } from '@shared/types'

export const XIAOYI_MANIFEST_ID = 'xiaoyi'

export const xiaoyiManifest: ChannelManifest = {
  id: XIAOYI_MANIFEST_ID,
  label: '华为小艺',
  description:
    '华为小艺云 A2A：AK/SK + agent_id → 双 WebSocket(主域名+备份 IP)客户端；平台经 message/stream 下发，本机以 agent_response 回传',
  icon: 'xiaoyi',
  category: 'assistant',
  region: 'domestic',
  priority: 41,
  qwenpawKey: 'xiaoyi',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl:
    'https://developer.huawei.com/consumer/cn/doc/doccenter-celia/agent2agent-0000002498656261',
  limitationBannerKey: 'channels.xiaoyi.limitation',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'edit-message',
    canSendCard: false,
    maxTextLength: 4000,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'require-prior-message',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'accessKey', label: 'Access Key', type: 'string', required: true },
    { name: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
    { name: 'agentId', label: 'Agent ID', type: 'string', required: true },
    {
      name: 'wsUrl',
      label: '主 WebSocket URL(可选)',
      type: 'string',
      default: 'wss://hag.cloud.huawei.com/openclaw/v1/ws/link',
    },
    {
      name: 'wsUrlBackup',
      label: '备份 WebSocket URL(可选)',
      type: 'string',
      default: 'wss://116.63.174.231/openclaw/v1/ws/link',
    },
    {
      name: 'allowFrom',
      label: '允许 sessionId(可选)',
      type: 'string',
    },
    {
      name: 'aclDm',
      label: '会话 ACL',
      type: 'string',
      default: 'open',
    },
  ],
  setupGuide: {
    title: '小艺连接清单',
    steps: [
      '在华为小艺开发者平台注册 A2A 智能体，取得 AK/SK 与 agent_id',
      '填写凭证并连接：桌面端作为双 WS 客户端连华为云(非本地 HTTP server)',
      '平台通过 message/stream 推送用户话术；回复走 agent_response',
      '产品语义：把本机 Agent 挂到小艺，非班级 IM 群播报',
    ],
  },
}
