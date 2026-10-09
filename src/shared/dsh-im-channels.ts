// 官方 dsh-im 负责登录和收消息的频道。
// 本进程再连一次，同一条消息会被两个机器人各答一遍。
// 设置页也不再给这些频道做第二套配置卡。

export const DSH_IM_CHANNEL_IDS = [
  'feishu',
  'dingtalk',
  'wecom',
  'weixin',
  'qq',
  'slack',
  'telegram',
  'discord',
  'matrix',
  'email',
] as const

const OWNED = new Set<string>(DSH_IM_CHANNEL_IDS)

export function isDshImChannel(id: string): boolean {
  return OWNED.has(id)
}
