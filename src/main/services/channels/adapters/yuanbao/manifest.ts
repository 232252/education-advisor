import type { ChannelManifest } from '@shared/types'

export const YUANBAO_MANIFEST_ID = 'yuanbao'

export const yuanbaoManifest: ChannelManifest = {
  id: YUANBAO_MANIFEST_ID,
  label: '腾讯元宝',
  description:
    '腾讯元宝 Bot：AppID + Secret → sign-token → protobuf WebSocket（AuthBind/Ping/C2C+群文本）',
  icon: 'yuanbao',
  category: 'assistant',
  region: 'domestic',
  priority: 40,
  qwenpawKey: 'yuanbao',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl: 'https://bot.yuanbao.tencent.com',
  limitationBannerKey: 'channels.yuanbao.limitation',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: 2800,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'appId', label: 'AppID / App Key', type: 'string', required: true },
    { name: 'appSecret', label: 'AppSecret', type: 'secret', required: true },
    {
      name: 'apiDomain',
      label: 'API 域名(可选)',
      type: 'string',
      default: 'https://bot.yuanbao.tencent.com',
    },
    {
      name: 'wsUrl',
      label: 'WebSocket URL(可选)',
      type: 'string',
      default: 'wss://bot-wss.yuanbao.tencent.com/wss/connection',
    },
    { name: 'routeEnv', label: 'Route Env(可选)', type: 'string' },
    {
      name: 'allowFrom',
      label: '允许发送者(可选,逗号分隔)',
      type: 'string',
      description: '配合 aclDm/aclGroup=allowlist',
    },
    {
      name: 'aclDm',
      label: '私聊 ACL',
      type: 'string',
      default: 'open',
      description: 'open | allowlist | deny',
    },
    {
      name: 'aclGroup',
      label: '群聊 ACL',
      type: 'string',
      default: 'open',
      description: 'open | allowlist | deny',
    },
  ],
  setupGuide: {
    title: '元宝连接清单',
    steps: [
      '在腾讯元宝开放平台创建 Bot，取得 AppID / AppSecret',
      '填写凭证并连接：将自动 sign-token → protobuf AuthBind',
      '支持私聊/群聊文本收发；媒体上传后续迭代',
      '产品语义：助手出站，非班级群播报',
    ],
  },
}
