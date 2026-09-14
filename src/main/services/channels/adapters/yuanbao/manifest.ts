import type { ChannelManifest } from '@shared/types'

export const YUANBAO_MANIFEST_ID = 'yuanbao'

export const yuanbaoManifest: ChannelManifest = {
  id: YUANBAO_MANIFEST_ID,
  label: '腾讯元宝',
  description: '腾讯元宝 Bot 开放平台:AppID + Secret。助手出站分区;protobuf WS 协议接入中。',
  icon: 'yuanbao',
  category: 'assistant',
  region: 'domestic',
  priority: 40,
  qwenpawKey: 'yuanbao',
  catalogStatus: 'enabled',
  beta: true,
  limitationBannerKey: 'channels.yuanbao.limitation',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'appId', label: 'AppID', type: 'string', required: true },
    { name: 'appSecret', label: 'AppSecret', type: 'secret', required: true },
  ],
  setupGuide: {
    title: '元宝连接清单',
    steps: [
      '在腾讯元宝开放平台创建 Bot,获取 AppID / AppSecret',
      '填入凭证后可保存配置;长连接协议适配持续完善',
      '产品语义:助手出站,不适合班级群播报',
    ],
  },
}
