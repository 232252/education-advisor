// =============================================================
// 共享 UI 工具函数 — 风险颜色、设计 tokens、class 合并、格式化
// R2-21: formatDate/formatDateTime/formatBytes 统一收敛至此
// (此前独立实现 5+ 处: Classes/lib/students、DataSection、
//  Models/lib/local-models、print 三件套的 stamp)
// =============================================================

import type { EAARiskLevel } from '@shared/types'

/** YYYY-MM-DD(接受 Date 或 epoch ms) */
export function formatDate(v: Date | number): string {
  const d = typeof v === 'number' ? new Date(v) : v
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今日日期字符串 YYYY-MM-DD(UTC 口径,与考试/快速录入的默认值一致) */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** YYYY-MM-DD HH:mm:ss(epoch ms) */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 人类可读字节大小 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 风险等级文字颜色（统一 4 处重复的 riskColor 函数） */
export function riskColor(risk: EAARiskLevel | string): string {
  switch (risk) {
    case '低':
      return 'text-green-500 dark:text-green-400'
    case '中':
      return 'text-yellow-500 dark:text-yellow-400'
    case '高':
      return 'text-orange-500 dark:text-orange-400'
    case '极高':
      return 'text-red-500 dark:text-red-400 font-bold'
    default:
      return 'text-gray-500'
  }
}

/** 风险等级背景色（用于 badge / 标签） */
export function riskBgColor(risk: EAARiskLevel | string): string {
  switch (risk) {
    case '低':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    case '中':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
    case '高':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
    case '极高':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
    default:
      return 'bg-gray-100 dark:bg-surface-elevated text-gray-600 dark:text-gray-400'
  }
}

/** 风险等级圆点色 */
export function riskDotColor(risk: EAARiskLevel | string): string {
  switch (risk) {
    case '低':
      return 'bg-green-500'
    case '中':
      return 'bg-yellow-500'
    case '高':
      return 'bg-orange-500'
    case '极高':
      return 'bg-red-500'
    default:
      return 'bg-gray-400'
  }
}

/** Agent 状态颜色 */
export function agentStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-blue-400 animate-pulse'
    case 'error':
      return 'bg-red-400'
    case 'idle':
      return 'bg-gray-400 dark:bg-gray-500'
    default:
      return 'bg-gray-300'
  }
}

/** 条件 class 合并（轻量版 clsx） */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * 分数/操行分变化颜色 — 正=进步(绿),负=退步(红),0=持平(灰)
 * 用于 DeltaBadge、CompareTab 汇总卡片等
 */
export function deltaColor(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) {
    return 'text-gray-500 dark:text-gray-400'
  }
  return delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
}

/**
 * 名次变化颜色 — 名次数值变小=上升(绿),变大=下降(红)
 * 与 deltaColor 符号相反:delta<0=进步(绿),delta>0=退步(红)
 */
export function rankDeltaColor(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) {
    return 'text-gray-500 dark:text-gray-400'
  }
  return delta < 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
}

/** 统一卡片样式 */
export const CARD_BASE =
  'rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary shadow-sm'

export const CARD_INTERACTIVE = `${CARD_BASE} transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-white/[0.12]`

/** 统一输入框样式 */
export const INPUT_BASE =
  'rounded-lg border border-gray-300 dark:border-white/[0.08] bg-white dark:bg-surface-elevated text-sm text-gray-900 dark:text-gray-100 px-3 py-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent focus:bg-white dark:focus:bg-[#22262f]'

/** 设置页小按钮 — 蓝色系(text-[10px],诊断/导出/测试连接等动作) */
export const BTN_SM_BLUE =
  'text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

/** 设置页小按钮 — 灰色系(text-[10px],次级动作如刷新列表) */
export const BTN_SM_GRAY =
  'text-[10px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors'

/** 紧凑型输入框 (Settings 表单 / 内联编辑场景, text-xs 字号) */
export const INPUT_SM =
  'rounded-lg border border-gray-300 dark:border-white/[0.08] bg-white dark:bg-surface-elevated text-xs text-gray-900 dark:text-gray-100 px-2.5 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent focus:bg-white dark:focus:bg-[#22262f]'

/** 校验失败的输入框样式 (与 INPUT_BASE 等价但使用红色边框 + 红色 ring) */
export const INPUT_INVALID =
  'rounded-lg border border-red-400 dark:border-red-500 bg-white dark:bg-surface-elevated text-sm text-gray-900 dark:text-gray-100 px-3 py-2 transition-all focus:outline-none focus:ring-2 focus:ring-red-500/60 focus:border-transparent'

/** 统一按钮样式 (使用 focus-visible 提升无障碍体验) */
export function btnStyle(
  variant: 'primary' | 'secondary' | 'danger' | 'ghost' = 'primary',
): string {
  const base =
    'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-primary disabled:opacity-50 disabled:cursor-not-allowed'
  switch (variant) {
    case 'primary':
      return `${base} bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white focus-visible:ring-blue-500 active:scale-[0.97] shadow-sm hover:shadow`
    case 'secondary':
      return `${base} bg-gray-100 dark:bg-surface-elevated hover:bg-gray-200 dark:hover:bg-white/[0.08] text-gray-700 dark:text-gray-300 focus-visible:ring-gray-400 border border-gray-200 dark:border-white/[0.08]`
    case 'danger':
      return `${base} bg-red-600 hover:bg-red-700 active:bg-red-800 text-white focus-visible:ring-red-500 active:scale-[0.97] shadow-sm hover:shadow`
    case 'ghost':
      return `${base} hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-600 dark:text-gray-400 focus-visible:ring-gray-400`
  }
}

/** ─── 表格统一样式常量 ─── */
export const TABLE_TH =
  'text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-white/[0.06] py-2.5 px-3 font-semibold'
export const TABLE_TD = 'py-2.5 px-3 text-sm'
export const TABLE_ROW =
  'border-b border-gray-100 dark:border-white/[0.06] hover:bg-blue-50/40 dark:hover:bg-white/[0.03] transition-colors'
export const TABLE_STICKY_HEAD = 'sticky top-0 bg-white dark:bg-surface-tertiary z-10'

/** 统一 badge 样式 */
export function badgeStyle(
  variant: 'info' | 'success' | 'warning' | 'danger' | 'neutral' = 'neutral',
): string {
  const base = 'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full'
  switch (variant) {
    case 'info':
      return `${base} bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400`
    case 'success':
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400`
    case 'warning':
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400`
    case 'danger':
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400`
    case 'neutral':
      return `${base} bg-gray-100 dark:bg-surface-elevated text-gray-600 dark:text-gray-400`
  }
}

// =============================================================
// 统计卡片主题渐变色(单一来源)
// MetricCard(Students) 与 DashboardStatCard(Dashboard) 共用:
// bg/border/text 为 Tailwind 组合类,from/to 为装饰渐变的 hex 端点
// =============================================================
export const GRADIENT_TONES = {
  blue: {
    from: '#3b82f6',
    to: '#1d4ed8',
    bg: 'from-blue-500/10 to-blue-600/5',
    border: 'border-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
    shadow: 'shadow-blue-500/10',
  },
  green: {
    from: '#22c55e',
    to: '#15803d',
    bg: 'from-green-500/10 to-green-600/5',
    border: 'border-green-500/20',
    text: 'text-green-600 dark:text-green-400',
    shadow: 'shadow-green-500/10',
  },
  yellow: {
    from: '#eab308',
    to: '#a16207',
    bg: 'from-yellow-500/10 to-yellow-600/5',
    border: 'border-yellow-500/20',
    text: 'text-yellow-600 dark:text-yellow-400',
    shadow: 'shadow-yellow-500/10',
  },
  purple: {
    from: '#a855f7',
    to: '#7e22ce',
    bg: 'from-purple-500/10 to-purple-600/5',
    border: 'border-purple-500/20',
    text: 'text-purple-600 dark:text-purple-400',
    shadow: 'shadow-purple-500/10',
  },
  red: {
    from: '#ef4444',
    to: '#b91c1c',
    bg: 'from-red-500/10 to-red-600/5',
    border: 'border-red-500/20',
    text: 'text-red-600 dark:text-red-400',
    shadow: 'shadow-red-500/10',
  },
} as const

export type GradientTone = keyof typeof GRADIENT_TONES
