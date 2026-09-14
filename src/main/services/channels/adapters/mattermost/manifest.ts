import type { ChannelManifest } from '@shared/types'

export const MATTERMOST_MANIFEST_ID = 'mattermost'

export const mattermostManifest: ChannelManifest = {
  id: MATTERMOST_MANIFEST_ID,
  label: 'Mattermost',
  description: '自托管 Mattermost(URL + bot token)。可国内私有化部署。',
  icon: 'mattermost',
  category: 'overseas',
  region: 'foreign',
  priority: 74,
  qwenpawKey: 'mattermost',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl: 'https://developers.mattermost.com/api-documentation/',
  limitationBannerKey: 'channels.mattermost.limitation',
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
    { name: 'baseUrl', label: '服务器 URL', type: 'string', required: true },
    { name: 'botToken', label: 'Bot Token', type: 'secret', required: true },
    { name: 'proxyUrl', label: '代理提示(可选)', type: 'string' },
  ],
  setupGuide: {
    title: 'Mattermost 连接清单',
    steps: [
      '在 Mattermost 创建 Bot 账号并生成 Personal Access Token / Bot Token',
      '填写服务器根 URL(如 https://mm.example.com)与 Token',
      '将 Bot 加入目标频道后即可收发',
    ],
  },
}
