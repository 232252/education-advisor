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
