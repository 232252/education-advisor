// =============================================================
// adapters/qq/manifest — QQ 官方机器人渠道自描述
// 拍板: 弱主动仍上架 + 显著 UI 提示;扫码 onboard 或凭证双模板
// =============================================================

import type { ChannelManifest } from '@shared/types'
import { QQ_GROUP_REPLY_WINDOW_MS, QQ_MANIFEST_ID } from './constants'

export { QQ_MANIFEST_ID }

export const qqManifest: ChannelManifest = {
  id: QQ_MANIFEST_ID,
  label: 'QQ',
  description:
    '用 QQ 官方机器人与本机 AI 助教对话。支持扫码绑定或填写 AppID/Secret;适合私聊问答。群主动消息配额极严,不适合定时群播报。',
  icon: 'qq',
  beta: true,
  loginKinds: ['qr', 'credentials'],
  limitationBannerKey: 'channels.qq.limitation',
  capabilities: {
    receivesVia: 'ws',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: 4000,
    replyWindowMs: QQ_GROUP_REPLY_WINDOW_MS,
    streamWindowMs: null,
    pushPolicy: 'quota',
    receivesFiles: false,
  },
  configSchema: [
    {
      name: 'appId',
      label: 'AppID',
      description: 'QQ 开放平台机器人 AppID;扫码成功后自动填入,也可手动填写',
      type: 'string',
      required: true,
    },
    {
      name: 'clientSecret',
      label: 'AppSecret',
      description: '机器人密钥,加密保存到本地 keystore;扫码绑定后自动写入',
      type: 'secret',
      required: true,
    },
    {
      name: 'allowGroups',
      label: '群聊响应(需 @机器人)',
      description: '关闭后只响应私聊(C2C)。注意:群主动推送配额极严',
      type: 'boolean',
      default: true,
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
    title: 'QQ 机器人连接清单',
    steps: [
      '推荐:在本卡点击「扫码连接」,用手机 QQ 扫描门户二维码完成绑定(无需先装 OpenClaw)',
      '或手动:打开 q.qq.com 创建机器人,复制 AppID / AppSecret 填入下方',
      '启用后可在 QQ 私聊机器人问答;群内需 @机器人,且被动回复窗口约 5 分钟',
      '群主动消息配额极严(约每月数条级)——定时成绩播报请改用飞书/钉钉/邮件',
      '本产品不接入 OneBot / NapCat / go-cqhttp 个人号路径',
    ],
  },
}
