// =============================================================
// adapters/weixin/manifest — 微信(个人)iLink/ClawBot 渠道自描述
// 拍板: 偏私聊 + 弱主动可接受;纯自建薄客户端;扫码优先
// =============================================================

import type { ChannelManifest } from '@shared/types'
import { WEIXIN_DEFAULT_BASE_URL, WEIXIN_MANIFEST_ID } from './constants'

export { WEIXIN_MANIFEST_ID }

export const weixinManifest: ChannelManifest = {
  id: WEIXIN_MANIFEST_ID,
  label: '微信',
  description:
    '用个人微信扫码连接本机 AI 助教(官方 iLink/ClawBot)。偏私聊问答;主动推送弱(需用户先发言取得会话令牌)。无需安装 OpenClaw。',
  icon: 'weixin',
  beta: true,
  loginKinds: ['qr', 'credentials'],
  limitationBannerKey: 'channels.weixin.limitation',
  capabilities: {
    receivesVia: 'polling',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: 4000,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'require-prior-message',
    receivesFiles: true,
  },
  configSchema: [
    {
      name: 'baseUrl',
      label: 'API 基址',
      description: `默认 ${WEIXIN_DEFAULT_BASE_URL};扫码成功后可能由服务端返回覆盖`,
      type: 'string',
      default: WEIXIN_DEFAULT_BASE_URL,
    },
    {
      name: 'botToken',
      label: 'Bot Token',
      description: '扫码确认后自动写入 keystore;也可高级粘贴(加密保存)',
      type: 'secret',
      required: true,
    },
    {
      name: 'agentId',
      label: '绑定 Agent',
      description: '该频道的消息交给哪个 Agent 处理(默认 main)',
      type: 'string',
      default: 'main',
    },
  ],
  setupGuide: {
    title: '微信 iLink / ClawBot 连接清单',
    steps: [
      '在本卡点击「扫码连接」,用个人微信扫描二维码并在手机上确认',
      '确认后 Bot Token 自动写入本机 keystore,无需安装 OpenClaw / 其他 sidecar',
      '启用频道后即可私聊本机 Agent;首次需你在微信里先发一句话',
      '主动推送(定时告警等)能力弱——依赖用户先发言留下的 context_token;群发请用飞书/钉钉/邮件',
      '本产品不支持 PID 挂钩、WeChatFerry 或关闭官方客户端的注入方案',
    ],
  },
}

