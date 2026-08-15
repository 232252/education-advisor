// =============================================================
// Button — 统一按钮组件
// 收敛全仓 btnStyle() 函数式调用 + 散落的硬编码按钮(原 H3 遗留问题)。
// 视觉与 btnStyle() 完全一致(primary/secondary/danger/ghost),
// 新增 success/warning/outline 变体,并支持 loading / icon / size / fullWidth。
// 现有代码可渐进迁移:旧 btnStyle() 继续可用,新代码优先用 <Button>。
// =============================================================

import { cn } from '@renderer/lib/ui-utils'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'ghost'
  | 'success'
  | 'warning'
  | 'outline'

export type ButtonSize = 'sm' | 'md' | 'lg' | 'xs'

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-primary disabled:opacity-50 disabled:cursor-not-allowed select-none'

const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-5 py-2.5 text-sm',
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white focus-visible:ring-blue-500 active:scale-[0.97] shadow-sm hover:shadow',
  secondary:
    'bg-gray-100 dark:bg-surface-elevated hover:bg-gray-200 dark:hover:bg-white/[0.08] text-gray-700 dark:text-gray-300 focus-visible:ring-gray-400 border border-gray-200 dark:border-white/[0.08]',
  danger:
    'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white focus-visible:ring-red-500 active:scale-[0.97] shadow-sm hover:shadow',
  ghost:
    'hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-600 dark:text-gray-400 focus-visible:ring-gray-400',
  success:
    'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white focus-visible:ring-green-500 active:scale-[0.97] shadow-sm hover:shadow',
  warning:
    'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white focus-visible:ring-amber-400 active:scale-[0.97] shadow-sm hover:shadow',
  outline:
    'border border-blue-500/50 dark:border-blue-400/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 dark:hover:bg-blue-400/10 focus-visible:ring-blue-400 bg-transparent',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 加载态: 显示旋转图标并禁用点击 */
  loading?: boolean
  /** 左侧图标 */
  icon?: ReactNode
  /** 右侧图标 */
  iconRight?: ReactNode
  /** 撑满父容器宽度 */
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        BASE,
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  )
})

export default Button
