// =============================================================
// adapters/feishu/manifest — 飞书渠道自描述(M1 初稿)
// 值来源: docs/research/2026-09-12-feishu-bot-ux-and-channel-architecture.md
// 频控/上限均为[官方]文档值;卡片流式走 CardKit(streamingKind='card-stream')。
// M3 起 FeishuAdapter 引用本 manifest;configSchema 键与
// settings.channels.feishu.*(M4 迁移)一一对应。
// =============================================================

import type { ChannelManifest } from '@shared/types'

export const FEISHU_MANIFEST_ID = 'feishu'

export const feishuManifest: ChannelManifest = {
  id: FEISHU_MANIFEST_ID,
  label: '飞书机器人',
  description:
    '在飞书里私聊或 @机器人,远程指挥这台电脑上的 AI 助教。WebSocket 长连接,无需公网 IP。',
  icon: 'feishu',
  category: 'enterprise-im',
  region: 'domestic',
  priority: 10,
  qwenpawKey: 'feishu',
  catalogStatus: 'enabled',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'card-stream',
    canSendCard: true,
    // im.message.reply 纯文本 4000 字截断(现 REPLY_CHAR_LIMIT);卡片 30KB 由流式卡自行控制
    maxTextLength: 4000,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: true,
  },
  configSchema: [
    {
      name: 'domain',
      label: '域名',
      description: '飞书(国内)或 Lark(国际)账号体系',
      type: 'select',
      options: [
        { value: 'feishu', label: '飞书(国内)' },
        { value: 'lark', label: 'Lark(国际)' },
      ],
      default: 'feishu',
      required: true,
    },
    {
      name: 'appId',
      label: 'App ID',
      description: '飞书开放平台应用 ID,以 cli_ 开头',
      type: 'string',
      required: true,
      pattern: '^cli_[0-9a-fA-F]{16}$',
    },
    {
      name: 'appSecret',
      label: 'App Secret',
      description: '应用密钥,加密保存到本地 keystore,不写入 settings.json',
      type: 'secret',
      required: true,
    },
    {
      name: 'allowGroups',
      label: '群聊响应(需 @机器人)',
      description: '关闭后只响应私聊消息',
      type: 'boolean',
      default: true,
    },
    {
      name: 'agentId',
      label: '绑定 Agent',
      description: '该频道的消息交给哪个 Agent 处理(默认 main;多频道建议分开绑定,避免排队互相挤占)',
      type: 'string',
      default: 'main',
    },
  ],
  setupGuide: {
    title: '飞书开放平台操作清单',
    steps: [
      '打开 open.feishu.cn → 开发者后台 → 创建企业自建应用',
      '添加「机器人」能力,事件订阅选择「使用长连接接收事件」(无需公网回调)',
      '订阅事件 im.message.receive_v1(接收消息)',
      '权限管理开通:im:message、im:message:send_as_bot(发消息)、im:resource(接收文件)、cardkit:card:write(流式卡片,缺省自动降级纯文本)',
      '创建版本并发布(企业管理员通常自动审批;未发布应用不可用)',
      '回到此处填写 App ID / App Secret,点「测试连接」验证',
    ],
  },
}
