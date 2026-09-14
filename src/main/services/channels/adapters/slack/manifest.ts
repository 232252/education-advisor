import type { ChannelManifest } from '@shared/types'

export const SLACK_MANIFEST_ID = 'slack'

export const slackManifest: ChannelManifest = {
  id: SLACK_MANIFEST_ID,
  label: 'Slack',
  description: 'Slack Socket Mode:Bot Token(xoxb) + App Token(xapp)。',
  icon: 'slack',
  category: 'overseas',
  region: 'foreign',
  priority: 72,
  qwenpawKey: 'slack',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl: 'https://api.slack.com/apis/connections/socket',
  limitationBannerKey: 'channels.slack.limitation',
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
    { name: 'botToken', label: 'Bot Token (xoxb)', type: 'secret', required: true },
    { name: 'appToken', label: 'App Token (xapp)', type: 'secret', required: true },
    { name: 'proxyUrl', label: '代理提示(可选)', type: 'string' },
  ],
  setupGuide: {
    title: 'Slack 连接清单',
    steps: [
      '创建 Slack App,开启 Socket Mode,生成 App-Level Token(connections:write)',
      'OAuth 安装 Bot,复制 Bot User OAuth Token(xoxb)',
      '订阅事件 message.im / message.channels 等,并邀请 Bot 进频道',
    ],
  },
}
