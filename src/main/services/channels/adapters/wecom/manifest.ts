// =============================================================
// adapters/wecom/manifest — 企微智能机器人渠道自描述(阶段 3 P1)
// 事实来源: docs/research/2026-09-12-channel-connector-catalog.md §2.2
//   - 智能机器人「长连接模式」(wss://openws.work.weixin.qq.com),免公网
//   - respond-stream 流式(同 req_id 反复刷新,finish 结束,10 分钟硬窗口)
//   - 主动推送需用户先发过消息(pushPolicy=require-prior-message)
//   - 附件 url+aeskey AES-256-CBC(5 分钟时效,收到即解密)
// 前置: 企微管理后台「智能机器人」开启 API 模式并选「长连接」。
// =============================================================

import type { ChannelManifest } from '@shared/types'

export const WECOM_MANIFEST_ID = 'wecom'

export const wecomManifest: ChannelManifest = {
  id: WECOM_MANIFEST_ID,
  label: '企微机器人',
  description:
    '在企业微信里私聊或 @机器人,远程指挥这台电脑上的 AI 助教。智能机器人长连接模式,无需公网 IP;回复以流式消息逐字呈现。',
  icon: 'wecom',
  beta: true,
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'respond-stream',
    canSendCard: true,
    // 官方未明示文本上限;与飞书/钉钉同档保守截断
    maxTextLength: 4000,
    // 回调后 24h 内可被动回复
    replyWindowMs: 24 * 60 * 60 * 1000,
    // 流式必须 10 分钟内完成(Bridge 提前强制收尾)
    streamWindowMs: 10 * 60 * 1000,
    pushPolicy: 'require-prior-message',
    receivesFiles: true,
  },
  configSchema: [
    {
      name: 'botId',
      label: 'Bot ID',
      description: '智能机器人的 Bot ID(管理后台 API 模式页可查)',
      type: 'string',
      required: true,
    },
    {
      name: 'secret',
      label: '长连接 Secret',
      description: 'API 模式选择「长连接」后生成的专用 Secret(非企业 CorpSecret),加密保存到本地 keystore',
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
      description: '该频道的消息交给哪个 Agent 处理(默认 main;多频道建议分开绑定)',
      type: 'string',
      default: 'main',
    },
  ],
  setupGuide: {
    title: '企业微信管理后台操作清单',
    steps: [
      '管理员打开企业微信管理后台 → 应用管理 → 智能机器人',
      '创建智能机器人(或选择既有机器人)→ 开启「API 模式」',
      '连接方式选择「长连接」(无需公网回调 URL),记录 Bot ID 与生成的长连接 Secret',
      '发布机器人并在企业内可见(成员需可在企微中搜索到该机器人)',
      '回到此处填写 Bot ID / 长连接 Secret,点「测试连接」验证',
      '在企微里私聊机器人,或在群里 @机器人 发送消息',
    ],
  },
}
