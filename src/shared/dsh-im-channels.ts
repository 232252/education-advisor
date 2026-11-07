// 官方 dsh-im 负责登录和收消息的频道。
// 本进程再连一次，同一条消息会被两个机器人各答一遍。
// 设置页也不再给这些频道做第二套配置卡。
//
// 5.9.1 起 dsh-im 又接管了企业微信自建应用、WhatsApp 和 iMessage，
// 5.10.0 再接管 office（文档处理钩子渠道），
// 这里必须同步，否则设置页会把它们当成"本进程自己的渠道"再出一张卡。

export const DSH_IM_CHANNEL_IDS = [
  'feishu',
  'dingtalk',
  'wecom',
  'wecom-app',
  'weixin',
  'qq',
  'slack',
  'telegram',
  'discord',
  'whatsapp',
  'imessage',
  'matrix',
  'email',
  'office',
] as const

const OWNED = new Set<string>(DSH_IM_CHANNEL_IDS)

export function isDshImChannel(id: string): boolean {
  return OWNED.has(id)
}
