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
  weixin: {
    gradient: 'from-[#07C160] to-[#06AD56]',
    shadow: 'shadow-[0_2px_8px_rgba(7,193,96,0.35)]',
  },
  qq: {
    gradient: 'from-[#12B7F5] to-[#1296DB]',
    shadow: 'shadow-[0_2px_8px_rgba(18,183,245,0.35)]',
  },
  yuanbao: {
    gradient: 'from-[#2B5AED] to-[#6B8CFF]',
    shadow: 'shadow-[0_2px_8px_rgba(43,90,237,0.35)]',
  },
  xiaoyi: {
    gradient: 'from-[#CF0A2C] to-[#FF4D6A]',
    shadow: 'shadow-[0_2px_8px_rgba(207,10,44,0.35)]',
  },
  email: {
    gradient: 'from-[#EA4335] to-[#FBBC04]',
    shadow: 'shadow-[0_2px_8px_rgba(234,67,53,0.3)]',
  },
  mqtt: {
    gradient: 'from-[#660066] to-[#9933CC]',
    shadow: 'shadow-[0_2px_8px_rgba(102,0,102,0.35)]',
  },
  sip: {
    gradient: 'from-[#0EA5E9] to-[#6366F1]',
    shadow: 'shadow-[0_2px_8px_rgba(14,165,233,0.3)]',
  },
  voice: {
    gradient: 'from-[#F59E0B] to-[#EF4444]',
    shadow: 'shadow-[0_2px_8px_rgba(245,158,11,0.3)]',
  },
  discord: {
    gradient: 'from-[#5865F2] to-[#7289DA]',
    shadow: 'shadow-[0_2px_8px_rgba(88,101,242,0.35)]',
  },
  telegram: {
    gradient: 'from-[#2AABEE] to-[#229ED9]',
    shadow: 'shadow-[0_2px_8px_rgba(42,171,238,0.35)]',
  },
  slack: {
    gradient: 'from-[#4A154B] to-[#E01E5A]',
    shadow: 'shadow-[0_2px_8px_rgba(74,21,75,0.35)]',
  },
  matrix: {
    gradient: 'from-[#0DBD8B] to-[#0B6E4F]',
    shadow: 'shadow-[0_2px_8px_rgba(13,189,139,0.3)]',
  },
  mattermost: {
    gradient: 'from-[#0058CC] to-[#1E325C]',
    shadow: 'shadow-[0_2px_8px_rgba(0,88,204,0.3)]',
  },
  imessage: {
    gradient: 'from-[#34C759] to-[#30D158]',
    shadow: 'shadow-[0_2px_8px_rgba(52,199,89,0.3)]',
  },
  'azure-bot': {
    gradient: 'from-[#0078D4] to-[#50E6FF]',
    shadow: 'shadow-[0_2px_8px_rgba(0,120,212,0.3)]',
  },
  onebot: {
    gradient: 'from-gray-500 to-gray-600',
    shadow: '',
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
