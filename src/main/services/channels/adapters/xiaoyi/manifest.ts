import type { ChannelManifest } from '@shared/types'

export const XIAOYI_MANIFEST_ID = 'xiaoyi'

export const xiaoyiManifest: ChannelManifest = {
  id: XIAOYI_MANIFEST_ID,
  label: '华为小艺',
  description: '华为小艺 A2A:AK/SK + agent_id。助手出站分区;双 WS 适配进行中。',
  icon: 'xiaoyi',
  category: 'assistant',
  region: 'domestic',
  priority: 41,
  qwenpawKey: 'xiaoyi',
  catalogStatus: 'enabled',
  beta: true,
  limitationBannerKey: 'channels.xiaoyi.limitation',
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
    { name: 'accessKey', label: 'Access Key', type: 'string', required: true },
    { name: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
    { name: 'agentId', label: 'Agent ID', type: 'string', required: true },
  ],
  setupGuide: {
    title: '小艺连接清单',
    steps: [
      '在华为小艺开放平台创建技能/Agent,获取 AK/SK 与 agent_id',
      '产品语义:将本机 Agent 挂到小艺,非班级 IM 群播报',
      'A2A 长连接适配持续完善',
    ],
  },
}
