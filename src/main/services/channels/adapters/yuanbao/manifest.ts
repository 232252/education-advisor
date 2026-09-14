import type { ChannelManifest } from '@shared/types'

export const YUANBAO_MANIFEST_ID = 'yuanbao'

export const yuanbaoManifest: ChannelManifest = {
  id: YUANBAO_MANIFEST_ID,
  label: '腾讯元宝',
  description:
    '腾讯元宝 Bot 开放平台:AppID + Secret。官方为 protobuf WS;本版可保存/探活凭证,长连接编解码待续。',
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
    maxTextLength: 4000,
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
    { name: 'routeEnv', label: 'Route Env(可选)', type: 'string' },
  ],
  setupGuide: {
    title: '元宝连接清单',
    steps: [
      '在腾讯元宝开放平台创建 Bot,获取 AppID / AppSecret',
      '填入并保存;连接时会尝试 sign-token 探活',
      '完整收发需 protobuf WebSocket 编解码(后续版本)',
      '产品语义:助手出站,不适合班级群播报',
    ],
  },
}
