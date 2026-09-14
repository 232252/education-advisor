// =============================================================
// channels/catalog — QwenPaw 全量目录占位 + 「更多」分组纯函数
// 单一数据源: registerChannelCatalog() 把未实现项注入 pendingManifests;
// 已实现适配器在各自 manifest 上补 category/region/qwenpawKey。
// UI 禁止硬编码第二份频道列表。
// =============================================================

import type { ChannelManifest } from '@shared/types'

export type ChannelCatalogGroupId =
  | 'enterprise-im'
  | 'consumer-im'
  | 'assistant'
  | 'email'
  | 'iot'
  | 'voice'
  | 'overseas'
  | 'unsupported'

export interface ChannelCatalogGroup {
  id: ChannelCatalogGroupId
  /** i18n key */
  labelKey: string
  /** 缺省中文 */
  labelDefault: string
  /** 海外组默认折叠 */
  collapsedByDefault?: boolean
}

/** 分组展示顺序(国内优先) */
export const CHANNEL_CATALOG_GROUPS: ChannelCatalogGroup[] = [
  { id: 'enterprise-im', labelKey: 'connectionCenter.more.group.enterprise', labelDefault: '国内企业' },
  { id: 'consumer-im', labelKey: 'connectionCenter.more.group.consumer', labelDefault: '国内个人' },
  { id: 'assistant', labelKey: 'connectionCenter.more.group.assistant', labelDefault: '国内助手' },
  { id: 'email', labelKey: 'connectionCenter.more.group.email', labelDefault: '邮件' },
  { id: 'iot', labelKey: 'connectionCenter.more.group.iot', labelDefault: '物联网' },
  { id: 'voice', labelKey: 'connectionCenter.more.group.voice', labelDefault: '语音' },
  {
    id: 'overseas',
    labelKey: 'connectionCenter.more.group.overseas',
    labelDefault: '海外',
    collapsedByDefault: true,
  },
  {
    id: 'unsupported',
    labelKey: 'connectionCenter.more.group.unsupported',
    labelDefault: '不可用',
    collapsedByDefault: true,
  },
]

export type CatalogCardStatus = 'enabled' | 'comingSoon' | 'later' | 'unsupported'

/** 从 manifest 推导目录卡状态(单一规则,UI/测试共用) */
export function resolveCatalogStatus(m: ChannelManifest): CatalogCardStatus {
  if (m.unsupportedReason || m.catalogStatus === 'unsupported') return 'unsupported'
  if (m.catalogStatus === 'later') return 'later'
  if (m.catalogStatus === 'comingSoon' || m.comingSoon) return 'comingSoon'
  if (m.catalogStatus === 'enabled') return 'enabled'
  // 已注册运行时且无 comingSoon → enabled
  if (!m.comingSoon) return 'enabled'
  return 'comingSoon'
}

export function resolveCatalogGroup(m: ChannelManifest): ChannelCatalogGroupId {
  if (m.unsupportedReason || m.catalogStatus === 'unsupported') return 'unsupported'
  if (m.category === 'enterprise-im') return 'enterprise-im'
  if (m.category === 'consumer-im') return 'consumer-im'
  if (m.category === 'assistant') return 'assistant'
  if (m.category === 'email') return 'email'
  if (m.category === 'iot') return 'iot'
  if (m.category === 'voice') return 'voice'
  if (m.category === 'overseas' || m.region === 'foreign') return 'overseas'
  if (m.category === 'local') return 'overseas'
  return 'enterprise-im'
}

export interface CatalogGroupBucket {
  group: ChannelCatalogGroup
  items: ChannelManifest[]
}

/** 搜索过滤: label / id / description / qwenpawKey */
export function filterCatalogManifests(
  manifests: ChannelManifest[],
  query: string,
): ChannelManifest[] {
  const q = query.trim().toLowerCase()
  if (!q) return manifests
  return manifests.filter((m) => {
    const hay = [m.id, m.label, m.description, m.qwenpawKey ?? '', m.icon]
      .join('\n')
      .toLowerCase()
    return hay.includes(q)
  })
}

/** 分组 + 组内按 priority 升序(缺省 999) */
export function groupCatalogManifests(manifests: ChannelManifest[]): CatalogGroupBucket[] {
  const sorted = [...manifests].sort((a, b) => {
    const pa = a.priority ?? 999
    const pb = b.priority ?? 999
    if (pa !== pb) return pa - pb
    return a.label.localeCompare(b.label, 'zh')
  })
  const byGroup = new Map<ChannelCatalogGroupId, ChannelManifest[]>()
  for (const m of sorted) {
    const g = resolveCatalogGroup(m)
    const list = byGroup.get(g) ?? []
    list.push(m)
    byGroup.set(g, list)
  }
  return CHANNEL_CATALOG_GROUPS.map((group) => ({
    group,
    items: byGroup.get(group.id) ?? [],
  })).filter((b) => b.items.length > 0)
}

/** 主列表精简:国内优先已实现渠道(≤6),不含 comingSoon/later/unsupported */
export function pickPrimaryChannelIds(manifests: ChannelManifest[], limit = 6): string[] {
  const primary = manifests
    .filter((m) => resolveCatalogStatus(m) === 'enabled')
    .filter((m) => m.region !== 'foreign')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  return primary.slice(0, limit).map((m) => m.id)
}

function stubCapabilities(
  receivesVia: ChannelManifest['capabilities']['receivesVia'],
): ChannelManifest['capabilities'] {
  return {
    receivesVia,
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  }
}

/**
 * QwenPaw 全量目录中「尚未有独立适配器文件」的占位 manifest。
 * 已实现的 feishu/dingtalk/wecom/weixin/qq 不在此表(由 adapter.manifest 提供)。
 */
export function buildQwenpawPendingManifests(): ChannelManifest[] {
  return [
    // 元宝 / 小艺 / 邮件 / MQTT 已注册真实适配器,勿在 pending 重复
    // —— 语音 ——
    {
      id: 'sip',
      label: 'SIP 语音',
      description: 'SIP/RTP 或 LiveKit 语音边车 + STT/TTS。建议在「语音」分区配置,慎作纯文本 IM。',
      icon: 'sip',
      category: 'voice',
      region: 'neutral',
      priority: 60,
      qwenpawKey: 'sip',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('sip'),
      configSchema: [],
    },
    {
      id: 'voice',
      label: 'Voice (Twilio)',
      description: 'Twilio ConversationRelay 电话语音;需公网 Webhook。国外倾向,后续版本。',
      icon: 'voice',
      category: 'voice',
      region: 'foreign',
      priority: 61,
      qwenpawKey: 'voice',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('webhook'),
      configSchema: [],
    },
    // —— 海外 ——
    {
      id: 'discord',
      label: 'Discord',
      description: 'Discord Bot Token;国内常需代理。目录可见,实现欢迎 PR。',
      icon: 'discord',
      category: 'overseas',
      region: 'foreign',
      priority: 70,
      qwenpawKey: 'discord',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('ws'),
      configSchema: [{ name: 'botToken', label: 'Bot Token', type: 'secret', required: true }],
    },
    {
      id: 'telegram',
      label: 'Telegram',
      description: 'Telegram BotFather Token;支持 edit-message 流式。国内常需代理。',
      icon: 'telegram',
      category: 'overseas',
      region: 'foreign',
      priority: 71,
      qwenpawKey: 'telegram',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: {
        ...stubCapabilities('polling'),
        streamingKind: 'edit-message',
      },
      configSchema: [{ name: 'botToken', label: 'Bot Token', type: 'secret', required: true }],
    },
    {
      id: 'slack',
      label: 'Slack',
      description: 'Slack Socket Mode:bot token + app token。后续版本 / PR。',
      icon: 'slack',
      category: 'overseas',
      region: 'foreign',
      priority: 72,
      qwenpawKey: 'slack',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('ws'),
      configSchema: [
        { name: 'botToken', label: 'Bot Token (xoxb)', type: 'secret', required: true },
        { name: 'appToken', label: 'App Token (xapp)', type: 'secret', required: true },
      ],
    },
    {
      id: 'matrix',
      label: 'Matrix',
      description: 'Matrix homeserver + access_token。后续版本 / PR。',
      icon: 'matrix',
      category: 'overseas',
      region: 'foreign',
      priority: 73,
      qwenpawKey: 'matrix',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('polling'),
      configSchema: [
        { name: 'homeserver', label: 'Homeserver URL', type: 'string', required: true },
        { name: 'userId', label: 'User ID', type: 'string', required: true },
        { name: 'accessToken', label: 'Access Token', type: 'secret', required: true },
      ],
    },
    {
      id: 'mattermost',
      label: 'Mattermost',
      description: '自托管 Mattermost(URL + bot token)。可国内私有化,产品仍标稍后。',
      icon: 'mattermost',
      category: 'overseas',
      region: 'foreign',
      priority: 74,
      qwenpawKey: 'mattermost',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('ws'),
      configSchema: [
        { name: 'baseUrl', label: '服务器 URL', type: 'string', required: true },
        { name: 'botToken', label: 'Bot Token', type: 'secret', required: true },
      ],
    },
    {
      id: 'imessage',
      label: 'iMessage',
      description: '仅 macOS:本地 chat.db + imsg。仅文本,无附件。',
      icon: 'imessage',
      category: 'overseas',
      region: 'foreign',
      priority: 75,
      qwenpawKey: 'imessage',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('polling'),
      configSchema: [],
    },
    {
      id: 'azure-bot',
      label: 'Azure Bot',
      description: 'Azure Bot Framework Webhook(Teams 等)。需公网 HTTPS 与 JWT 校验。',
      icon: 'azure-bot',
      category: 'overseas',
      region: 'foreign',
      priority: 76,
      qwenpawKey: 'azure_bot',
      catalogStatus: 'later',
      comingSoon: true,
      capabilities: stubCapabilities('webhook'),
      configSchema: [
        { name: 'appId', label: 'App ID', type: 'string', required: true },
        { name: 'appPassword', label: 'App Password', type: 'secret', required: true },
        { name: 'tenantId', label: 'Tenant ID', type: 'string' },
      ],
    },
    // —— 不可用 ——
    {
      id: 'onebot',
      label: 'OneBot',
      description: 'OneBot v11 / NapCat 等个人号完整协议。本产品明确不支持。',
      icon: 'onebot',
      category: 'consumer-im',
      region: 'domestic',
      priority: 90,
      qwenpawKey: 'onebot',
      catalogStatus: 'unsupported',
      comingSoon: true,
      unsupportedReason:
        '个人号完整协议存在合规与封号风险;产品禁止 OneBot/NapCat/PID Hook 作为主路径。请使用 QQ 官方机器人。',
      capabilities: stubCapabilities('relay-ws'),
      configSchema: [],
    },
  ]
}

