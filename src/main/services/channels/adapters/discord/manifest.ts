import type { ChannelManifest } from '@shared/types'

export const DISCORD_MANIFEST_ID = 'discord'

export const discordManifest: ChannelManifest = {
  id: DISCORD_MANIFEST_ID,
  label: 'Discord',
  description: 'Discord Bot Token + Gateway。须开启 Message Content Intent;国内常需代理。',
  icon: 'discord',
  category: 'overseas',
  region: 'foreign',
  priority: 70,
  qwenpawKey: 'discord',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl: 'https://discord.com/developers/docs/intro',
  limitationBannerKey: 'channels.discord.limitation',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: 2000,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'botToken', label: 'Bot Token', type: 'secret', required: true },
    {
      name: 'proxyUrl',
      label: '代理提示(可选)',
      type: 'string',
      description: '仅作状态提示;请在系统/环境配置实际 HTTP(S) 代理',
    },
  ],
  setupGuide: {
    title: 'Discord 连接清单',
    steps: [
      '在 Discord Developer Portal 创建 Application → Bot,复制 Token',
      'Privileged Gateway Intents 开启 Message Content Intent',
      '将 Bot 邀请进服务器(含 Send Messages / Read Message History)',
      '国内网络请配置系统代理后再点连接',
    ],
  },
}
