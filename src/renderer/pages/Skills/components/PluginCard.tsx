// =============================================================
// PluginCard — 单个插件卡(计数概览 + 跳转管理)
// 结构自 tabs/PluginsTab.tsx 逐字搬移
// =============================================================

import { useNavigate } from 'react-router-dom'
import { Card } from '../../../components/Card'
import { useT } from '../../../i18n'

/** 单个插件卡的 props */
export interface PluginCardProps {
  icon: React.ReactNode
  title: string
  description: string
  /** 主行计数文案，例 "3 个服务器 · 2 已连接" */
  countText: string
  /** 跳转按钮文案 */
  manageLabel: string
  /** 跳转目标 hash 路径，例 "/skills" */
  to: string
  /** 跳转后是否需要切到特定 Tab，传 tab key 会被 localStorage 写入 */
  tabKey?: string
  tabValue?: string
  /** 已禁用态 */
  disabled?: boolean
  /** 禁用态展示文案 */
  disabledText?: string
}

export function PluginCard({
  icon,
  title,
  description,
  countText,
  manageLabel,
  to,
  tabKey,
  tabValue,
  disabled,
  disabledText,
}: PluginCardProps) {
  const { t } = useT()
  const navigate = useNavigate()

  const handleGo = () => {
    if (disabled) return
    // 预设 Tab：写入 localStorage 后导航，目标页 useEffect 会读取
    if (tabKey && tabValue) {
      try {
        window.localStorage.setItem(tabKey, tabValue)
      } catch {
        // 忽略 localStorage 异常（隐私模式等）
      }
    }
    navigate(to)
  }

  return (
    <Card className="flex flex-col p-4 gap-2">
      <div className="flex items-start gap-3">
        <span
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/15 dark:to-indigo-500/15 text-blue-500 dark:text-blue-400 ring-1 ring-blue-200/60 dark:ring-blue-400/20"
          aria-hidden
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
            {description}
          </p>
        </div>
      </div>
      <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
        {disabled ? (
          <span className="text-amber-600 dark:text-amber-400">
            {disabledText || t('common.disabled')}
          </span>
        ) : (
          <span>{countText}</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleGo}
        disabled={disabled}
        className="self-start mt-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
      >
        {manageLabel}
      </button>
    </Card>
  )
}
