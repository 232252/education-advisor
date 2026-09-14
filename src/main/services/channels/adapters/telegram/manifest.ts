import type { ChannelManifest } from '@shared/types'

export const TELEGRAM_MANIFEST_ID = 'telegram'

export const telegramManifest: ChannelManifest = {
  id: TELEGRAM_MANIFEST_ID,
  label: 'Telegram',
  description: 'Telegram BotFather Token;长轮询收信 + editMessageText 流式。国内常需代理。',
  icon: 'telegram',
  category: 'overseas',
  region: 'foreign',
  priority: 71,
  qwenpawKey: 'telegram',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl: 'https://core.telegram.org/bots/api',
  limitationBannerKey: 'channels.telegram.limitation',
  capabilities: {
    receivesVia: 'polling',
    streamingKind: 'edit-message',
    canSendCard: false,
    maxTextLength: 4096,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'botToken', label: 'Bot Token', type: 'secret', required: true },
    {
      name: 'apiBase',
      label: 'API Base(可选)',
      type: 'string',
      default: 'https://api.telegram.org',
      description: '可用自建 Bot API 反代缓解网络限制',
    },
    { name: 'proxyUrl', label: '代理提示(可选)', type: 'string' },
  ],
  setupGuide: {
    title: 'Telegram 连接清单',
    steps: [
      '在 BotFather 创建 Bot 并复制 Token',
      '可选:配置 apiBase 指向可达的 Bot API 反代',
      '向 Bot 发一条消息后即可双向对话;群聊需禁用隐私模式或 @提及',
    ],
  },
}
