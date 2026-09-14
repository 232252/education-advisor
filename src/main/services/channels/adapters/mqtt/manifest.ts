import type { ChannelManifest } from '@shared/types'

export const MQTT_MANIFEST_ID = 'mqtt'

export const mqttManifest: ChannelManifest = {
  id: MQTT_MANIFEST_ID,
  label: 'MQTT',
  description: '物联网消息桥:订阅/发布 JSON 或文本 topic,对接教研教具与传感器。',
  icon: 'mqtt',
  category: 'iot',
  region: 'neutral',
  priority: 50,
  qwenpawKey: 'mqtt',
  catalogStatus: 'enabled',
  beta: true,
  capabilities: {
    receivesVia: 'mqtt',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'host', label: 'Broker 主机', type: 'string', required: true },
    { name: 'port', label: '端口', type: 'number', default: 1883, required: true },
    { name: 'username', label: '用户名', type: 'string' },
    { name: 'password', label: '密码', type: 'secret' },
    { name: 'subscribeTopic', label: '订阅 Topic', type: 'string', required: true },
    { name: 'publishTopic', label: '发布 Topic', type: 'string', required: true },
    { name: 'tls', label: '启用 TLS', type: 'boolean', default: false },
  ],
  setupGuide: {
    title: 'MQTT 连接清单',
    steps: [
      '准备可访问的 MQTT Broker(或本机 Mosquitto)',
      '填写订阅/发布 Topic;入站 JSON 将桥接到本机 Agent',
      '生产环境建议开启 TLS 与独立 ACL 账号',
    ],
  },
}
