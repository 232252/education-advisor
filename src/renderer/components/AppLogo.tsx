// AppLogo — 应用品牌标识组件
// =============================================================
// 设计意图: 让应用内 Logo 与系统图标(任务栏/托盘 resources/icon.svg)保持一致,
// 解决此前"应用内是 CSS 方块+E 字, 系统是网络+书 SVG"的品牌割裂问题。
// 内联 SVG 而非 <img>, 保证:
//   1. 无网络/文件加载延迟, 首屏即现
//   2. 可随父容器任意缩放且始终锐利(矢量)
//   3. 渐变 id 带随机后缀, 避免多实例冲突
// 视觉与 resources/icon.svg 完全对齐: 蓝靛渐变底 + 青色网络节点 + 琥珀核心 + 白色书页。
// =============================================================

import { useId } from 'react'

interface AppLogoProps {
  /** 边长 px, 默认 32 */
  size?: number
  /** 显示运行状态指示点(右上角), 默认 true */
  showStatusDot?: boolean
  /** 运行状态: running=蓝+脉冲, error=红, idle=绿(默认) */
  status?: 'idle' | 'running' | 'error'
  className?: string
}

export function AppLogo({
  size = 32,
  showStatusDot = true,
  status = 'idle',
  className = '',
}: AppLogoProps) {
  // useId 保证多实例渐变 id 不冲突
  const uid = useId().replace(/[:]/g, '')

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Education Advisor"
        role="img"
      >
        <defs>
          <linearGradient
            id={`bg-${uid}`}
            x1="0"
            y1="0"
            x2="1024"
            y2="1024"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#3B82F6" />
            <stop offset="1" stopColor="#4F46E5" />
          </linearGradient>
          <linearGradient
            id={`sheen-${uid}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1024"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.18" />
            <stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 圆角渐变背景 + 顶部微光 */}
        <rect x="0" y="0" width="1024" height="1024" rx="220" ry="220" fill={`url(#bg-${uid})`} />
        <rect
          x="0"
          y="0"
          width="1024"
          height="1024"
          rx="220"
          ry="220"
          fill={`url(#sheen-${uid})`}
        />

        {/* 多智能体网络 (上半) */}
        <g stroke="#22D3EE" strokeWidth="34" strokeLinecap="round" fill="none" opacity="0.95">
          <line x1="322" y1="330" x2="702" y2="330" />
          <line x1="322" y1="330" x2="512" y2="196" />
          <line x1="702" y1="330" x2="512" y2="196" />
          <line x1="512" y1="196" x2="512" y2="430" />
        </g>
        <g>
          <circle cx="322" cy="330" r="72" fill="#22D3EE" />
          <circle cx="702" cy="330" r="72" fill="#22D3EE" />
          <circle cx="512" cy="196" r="72" fill="#22D3EE" />
          <circle cx="512" cy="430" r="52" fill="#FBBF24" />
        </g>

        {/* 打开的书 (下半) */}
        <g>
          <path d="M 176 610 L 512 566 L 512 836 L 176 884 Z" fill="#FFFFFF" />
          <path d="M 848 610 L 512 566 L 512 836 L 848 884 Z" fill="#DBEAFE" />
          <line
            x1="512"
            y1="566"
            x2="512"
            y2="836"
            stroke="#1E3A8A"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <g stroke="#1E3A8A" strokeWidth="26" strokeLinecap="round" opacity="0.28">
            <line x1="244" y1="680" x2="444" y2="654" />
            <line x1="244" y1="742" x2="444" y2="716" />
            <line x1="580" y1="654" x2="780" y2="680" />
            <line x1="580" y1="716" x2="780" y2="742" />
          </g>
        </g>
      </svg>

      {/* 运行状态指示点 — 颜色随 status 变化, 反映真实 agent 状态 */}
      {showStatusDot && (
        <span
          className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-2 ring-white dark:ring-surface-secondary ${
            status === 'running'
              ? 'bg-blue-500 dark:bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.7)] animate-pulse'
              : status === 'error'
                ? 'bg-red-500 dark:bg-red-400 shadow-[0_0_4px_rgba(239,68,68,0.5)]'
                : 'bg-emerald-400'
          }`}
        />
      )}
    </div>
  )
}
