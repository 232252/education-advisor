import type { ChannelManifest } from '@shared/types'

export const XIAOYI_MANIFEST_ID = 'xiaoyi'

export const xiaoyiManifest: ChannelManifest = {
  id: XIAOYI_MANIFEST_ID,
  label: '华为小艺',
  description:
    '华为小艺云 A2A:AK/SK + agent_id。平台回调你的 HTTP Agent(非桌面主动连 IM);本版凭证可存,服务端待续。',
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
    receivesVia: 'webhook',
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
    {
      name: 'publicEndpoint',
      label: '公网 A2A Endpoint(可选提示)',
      type: 'string',
      description: '小艺将 POST 到此 URL;需后续版本内置 agent-server',
    },
  ],
  setupGuide: {
    title: '小艺连接清单',
    steps: [
      '在华为小艺开放平台创建云 A2A 智能体,获取 AK/SK 与 agent_id',
      '理解模型:小艺调用你的 HTTP Agent(JSON-RPC/SSE),非本机主动连 WS',
      '填写凭证可保存;完整对接需 EA 暴露 A2A agent-server(后续版本)',
      '产品语义:挂到小艺助手,非班级 IM 群播报',
    ],
  },
}
