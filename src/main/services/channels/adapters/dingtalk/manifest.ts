// =============================================================
// adapters/dingtalk/manifest — 钉钉渠道自描述(阶段 2 P0 启用)
// 事实来源: docs/research/2026-09-12-channel-connector-catalog.md §2.1
//   - Stream Mode(出站 WSS)桌面直连,免公网 IP
//   - AI 卡片 streamingUpdate 打字机(官方公共模板,cardTemplateId 可覆盖)
//   - downloadCode 两跳文件下载;群聊需 @机器人
// 权限: Card.Streaming.Write / Card.Instance.Write / qyapi_robot_sendmsg
// =============================================================

import type { ChannelManifest } from '@shared/types'

export const DINGTALK_MANIFEST_ID = 'dingtalk'

export const dingtalkManifest: ChannelManifest = {
  id: DINGTALK_MANIFEST_ID,
  label: '钉钉机器人',
  description:
    '在钉钉里私聊或 @机器人,远程指挥这台电脑上的 AI 助教。Stream 模式 WebSocket 长连接,无需公网 IP;回复以 AI 卡片打字机流式呈现。',
  icon: 'dingtalk',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'card-stream',
    canSendCard: true,
    // 官方未明示文本上限;与飞书同档保守截断,实测后可放宽
    maxTextLength: 4000,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: true,
  },
  configSchema: [
    {
      name: 'clientId',
      label: 'Client ID',
      description: '钉钉开放平台应用的 Client ID(旧称 AppKey)',
      type: 'string',
      required: true,
    },
    {
      name: 'clientSecret',
      label: 'Client Secret',
      description: '应用密钥(旧称 AppSecret),加密保存到本地 keystore,不写入 settings.json',
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
    {
      name: 'cardTemplateId',
      label: 'AI 卡片模板 ID(可选)',
      description: '默认使用钉钉官方公共 AI 卡片模板;如需自定义样式,填卡片平台的模板 ID',
      type: 'string',
    },
  ],
  setupGuide: {
    title: '钉钉开放平台操作清单',
    steps: [
      '打开 open.dingtalk.com → 应用开发 → 创建企业内部应用',
      '添加「机器人」能力,消息接收模式选择「Stream 模式」(无需公网回调)',
      '权限管理开通:qyapi_robot_sendmsg(机器人发消息)、Card.Instance.Write / Card.Streaming.Write(AI 卡片流式)',
      '创建版本并发布(需企业管理员审核;应用须发布后才可用)',
      '回到此处填写 Client ID / Client Secret,点「测试连接」验证',
      '在钉钉里找到机器人私聊,或在群里 @机器人 发送消息',
    ],
  },
}
