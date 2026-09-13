// =============================================================
// ChannelBrandIcon — 频道品牌渐变图标瓦片(连接中心面板/设置页卡片共用)
// 每渠道一个品牌色渐变 + 白色字形单字;后续换官方 SVG 只改本文件。
// 渐变写死在源码字符串里,Tailwind 扫描器可直接提取。
// =============================================================

import { cn } from '../../lib/ui-utils'

interface ChannelBrandIconProps {
  /** manifest.id(feishu / dingtalk / wecom / …) */
  channelId: string
  /** 渠道显示名(取首字作字形) */
  label: string
  /** manifest.icon 兜底字形来源 */
  icon?: string
  /** sm=面板行(34px) md=设置页卡片(36px) */
  size?: 'sm' | 'md'
  /** 占位渠道(comingSoon)用灰色瓦片 */
  muted?: boolean
  className?: string
}

const BRAND: Record<string, { gradient: string; shadow: string }> = {
  feishu: {
    gradient: 'from-[#3370FF] to-[#5B8CFF]',
    shadow: 'shadow-[0_2px_8px_rgba(51,112,255,0.35)]',
  },
  dingtalk: {
    gradient: 'from-[#0089FF] to-[#00B2FF]',
    shadow: 'shadow-[0_2px_8px_rgba(0,137,255,0.35)]',
  },
  wecom: {
    gradient: 'from-[#00A944] to-[#33C46E]',
    shadow: 'shadow-[0_2px_8px_rgba(0,169,68,0.35)]',
  },
}

const DEFAULT_BRAND = {
  gradient: 'from-blue-500 to-indigo-500',
  shadow: 'shadow-[0_2px_8px_rgba(59,130,246,0.3)]',
}

const MUTED_BRAND = {
  gradient: 'from-gray-400 to-gray-500 dark:from-gray-600 dark:to-gray-700',
  shadow: '',
}

export function ChannelBrandIcon({
  channelId,
  label,
  icon,
  size = 'md',
  muted = false,
  className,
}: ChannelBrandIconProps) {
  const brand = muted ? MUTED_BRAND : (BRAND[channelId] ?? DEFAULT_BRAND)
  return (
    <span
      aria-hidden
      className={cn(
        'bg-gradient-to-br text-white flex items-center justify-center font-bold select-none flex-shrink-0',
        'ring-1 ring-white/20',
        brand.gradient,
        brand.shadow,
        size === 'sm' ? 'w-[34px] h-[34px] rounded-[10px] text-sm' : 'w-9 h-9 rounded-xl text-base',
        className,
      )}
    >
      {label.slice(0, 1) || (icon ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )
}
