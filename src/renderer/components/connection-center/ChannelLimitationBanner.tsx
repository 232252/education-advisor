// =============================================================
// ChannelLimitationBanner — QQ/微信限制显著提示(不可仅靠 toast)
// =============================================================

import { AlertTriangle } from 'lucide-react'
import { useT } from '../../i18n'
import { cn } from '../../lib/ui-utils'

interface ChannelLimitationBannerProps {
  /** manifest.limitationBannerKey */
  bannerKey?: string
  className?: string
}

const FALLBACK: Record<string, string> = {
  'channels.qq.limitation':
    'QQ 群主动消息配额极严(约每月数条),被动回复窗口约 5 分钟。适合私聊问答;定时群播报请用飞书/钉钉/邮件。',
  'channels.weixin.limitation':
    '微信(个人 iLink)偏私聊;主动推送弱,需用户先发言取得会话令牌。不适合作为定时告警主通道。',
  'channels.email.limitation':
    'SMTP 发信 + IMAP IDLE/轮询收信已接入;IDLE 失败会自动降级轮询。建议专用通知邮箱。',
  'channels.yuanbao.limitation':
    '元宝为助手出站通道。可探活 sign-token;完整收发需 protobuf WS 编解码(尚未内置)。不适合班级群播报。',
  'channels.xiaoyi.limitation':
    '小艺云 A2A 是平台回调你的 HTTP Agent,不是桌面主动连 IM;需后续 agent-server。非班级群通道。',
  'channels.discord.limitation':
    '海外频道:需 Discord Bot Token 与 Message Content Intent;国内网络常需系统代理。',
  'channels.telegram.limitation':
    '海外频道:BotFather Token + 长轮询;可用 apiBase 反代。国内常需代理。',
  'channels.slack.limitation':
    '海外频道:需 Socket Mode(xoxb + xapp);国内常需代理。',
  'channels.matrix.limitation':
    '海外/联邦:homeserver + access_token;Bot 须已加入目标房间。',
  'channels.mattermost.limitation':
    '可自托管:服务器 URL + Bot Token。国内私有化友好。',
}

export function ChannelLimitationBanner({ bannerKey, className }: ChannelLimitationBannerProps) {
  const { t } = useT()
  if (!bannerKey) return null
  const text = t(bannerKey, FALLBACK[bannerKey] ?? bannerKey)
  return (
    <div
      role="note"
      data-testid="channel-limitation-banner"
      data-banner-key={bannerKey}
      className={cn(
        'flex gap-2 items-start rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
        'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
        className,
      )}
    >
      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
      <span>{text}</span>
    </div>
  )
}
