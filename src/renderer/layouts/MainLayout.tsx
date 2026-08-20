// =============================================================
// 主布局 — 侧边栏导航 + 内容区
// M22 瘦身: bootstrap 上移 App.tsx; 快捷键 → useGlobalShortcuts;
//          Agent 状态列表 → AgentStatusBar; 折叠持久化 → useLocalStorage
// =============================================================

import { PanelLeft, PanelLeftClose, Search } from 'lucide-react'
import { useCallback } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AppLogo } from '../components/AppLogo'
import { CommandPalette } from '../components/command-palette/CommandPalette'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { NotificationCenter } from '../components/notification/NotificationCenter'
import { useNotificationListener } from '../components/notification/useNotificationListener'
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard'
import { ThemeToggle } from '../components/ThemeToggle'
import { NAV_ITEMS } from '../config/nav-items'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useT } from '../i18n'
import { cn } from '../lib/ui-utils'
import { useAgentStore } from '../stores/agent/store'
import { usePaletteStore } from '../stores/paletteStore'
import { AgentStatusBar } from './AgentStatusBar'

/** localStorage key for sidebar collapsed state */
const SIDEBAR_COLLAPSED_KEY = 'ea.sidebar.collapsed'

// 旧版以 '1'/'0' 明文存储,一次性迁移为 useLocalStorage 的 JSON 布尔格式
;(function migrateLegacyCollapsed() {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (raw === '1' || raw === '0') {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(raw === '1'))
    }
  } catch {
    /* localStorage 不可用时静默降级 */
  }
})()

export function MainLayout() {
  const { t } = useT()
  const location = useLocation()
  const agents = useAgentStore((s) => s.agents)

  // 可折叠侧边栏: 状态持久化到 localStorage, 折叠后只显示图标列
  // (历史值可能为明文 '1'/'0' 解析出的 1/0,Boolean 归一保证语义)
  const [storedCollapsed, setCollapsed] = useLocalStorage<boolean>(SIDEBAR_COLLAPSED_KEY, false)
  const collapsed = Boolean(storedCollapsed)
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [setCollapsed])

  // 桌面级全局快捷键 (Ctrl+1..9 / Ctrl+, / Ctrl+B)
  useGlobalShortcuts({ onToggleSidebar: toggleCollapsed })

  // 全局搜索命令面板 (Ctrl+K) — 侧边栏按钮入口,快捷键由 CommandPalette 自行监听
  const togglePalette = useCallback(() => {
    usePaletteStore.getState().toggle()
  }, [])

  // 通知中心事件监听 — Agent 运行结果/定时任务状态 → 通知面板(全局挂载一次)
  useNotificationListener()

  const runningCount = agents.filter((a) => a.status === 'running').length
  const errorCount = agents.filter((a) => a.status === 'error').length
  // Logo 状态点反映全局 agent 状态: 有错误→红, 有运行→蓝脉冲, 否则→绿
  const logoStatus = errorCount > 0 ? 'error' : runningCount > 0 ? 'running' : 'idle'

  return (
    <div className="flex h-screen bg-canvas text-gray-900 dark:text-gray-100">
      {/* ── 侧边栏 ── */}
      <aside
        className={cn(
          'flex-shrink-0 border-r border-gray-200/60 dark:border-white/[0.06] flex flex-col bg-white/80 dark:bg-surface-secondary/90 backdrop-blur-xl transition-all duration-200 ease-out',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        {/* Logo + 折叠按钮 */}
        <div
          className={cn(
            'flex items-center border-b border-gray-200/60 dark:border-white/[0.06] relative',
            collapsed ? 'flex-col justify-center gap-2 h-[76px] py-2' : 'h-16 px-5 gap-3',
          )}
        >
          {/* 统一品牌标识: 与系统图标(任务栏/托盘)完全一致的真实 SVG */}
          <div className="transition-transform duration-200 hover:scale-105 drop-shadow-md shadow-blue-500/20 flex-shrink-0">
            <AppLogo size={32} status={logoStatus} />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold tracking-tight text-gray-900 dark:text-white leading-tight truncate">
                {t('app.name', 'Education Advisor')}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide truncate">
                {t('app.tagline', '智能教育管理助手')}
              </span>
            </div>
          )}
          {/* 折叠/展开按钮 — 展开态浮在右侧; 折叠态在 Logo 下方居中 */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={
              collapsed ? t('sidebar.expand', '展开侧边栏') : t('sidebar.collapse', '折叠侧边栏')
            }
            title={`${t('sidebar.toggle', '折叠/展开')} (Ctrl+B)`}
            className={cn(
              'inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 dark:text-gray-500 flex-shrink-0',
              'hover:bg-gray-100 dark:hover:bg-white/[0.08] hover:text-gray-700 dark:hover:text-gray-300',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 transition-colors',
              collapsed ? '' : 'absolute right-2 top-1/2 -translate-y-1/2',
            )}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* 导航 */}
        <nav className={cn('flex-1 py-3 overflow-y-auto space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
          {/* 全局搜索入口 — 点击或 Ctrl+K 打开命令面板 */}
          <button
            type="button"
            onClick={togglePalette}
            aria-label={t('palette.trigger', '全局搜索')}
            title={`${t('palette.trigger', '全局搜索')} (Ctrl+K)`}
            className={cn(
              'mb-2 flex items-center text-[13px] font-medium rounded-lg border border-gray-200/80 dark:border-white/[0.08]',
              'bg-gray-50/80 dark:bg-white/[0.03] text-gray-400 dark:text-gray-500',
              'hover:bg-gray-100 dark:hover:bg-white/[0.07] hover:text-gray-600 dark:hover:text-gray-300',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors',
              collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2',
            )}
          >
            <Search size={16} className="flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate flex-1 text-left">
                  {t('palette.triggerLabel', '搜索…')}
                </span>
                <kbd className="ml-auto font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.06]">
                  Ctrl K
                </kbd>
              </>
            )}
          </button>
          {NAV_ITEMS.map((item, idx) => {
            const Icon = item.icon
            const shortcut = idx < 9 ? idx + 1 : null
            const label = t(item.labelKey)
            return (
              <NavLink
                key={item.path}
                to={item.path}
                title={collapsed ? `${label}${shortcut ? ` (Ctrl+${shortcut})` : ''}` : undefined}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center text-[13px] font-medium rounded-lg transition-all duration-200',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2',
                    isActive
                      ? 'bg-gradient-to-r from-blue-500/[0.12] to-indigo-500/[0.06] text-blue-700 dark:text-blue-400 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)] dark:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.18)]'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.05] hover:text-gray-800 dark:hover:text-gray-200',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* 左侧高亮指示条 — 激活时显示(品牌渐变) */}
                    <span
                      className={cn(
                        'absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-gradient-to-b from-blue-500 to-indigo-500 dark:from-blue-400 dark:to-indigo-400 transition-all duration-200',
                        isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0',
                      )}
                      aria-hidden="true"
                    />
                    <Icon
                      size={19}
                      strokeWidth={isActive ? 2.4 : 2.0}
                      className="flex-shrink-0 transition-all duration-200"
                    />
                    {!collapsed && <span className="truncate flex-1">{label}</span>}
                    {/* 快捷键提示徽章 — 前 9 项显示数字, hover 时高亮(仅展开态) */}
                    {shortcut && !collapsed && (
                      <kbd className="ml-auto hidden md:inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded font-mono text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {shortcut}
                      </kbd>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Agent 状态 — 折叠态只显示状态点列 */}
        <AgentStatusBar agents={agents} collapsed={collapsed} />

        {/* 底部工具区: 通知中心 + 主题切换 (折叠态纵向堆叠,展开态横向排列) */}
        <div
          className={cn(
            'border-t border-gray-200/60 dark:border-white/[0.06]',
            collapsed ? 'p-2 flex flex-col items-center gap-1' : 'p-3 flex items-center gap-2',
          )}
        >
          <NotificationCenter />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <ThemeToggle />
            </div>
          )}
          {collapsed && <ThemeToggle iconOnly />}
        </div>
      </aside>

      {/* ── 内容区 ── */}
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary resetKey={location.pathname}>
          <div className="h-full page-enter">
            <Outlet />
          </div>
        </ErrorBoundary>
      </main>

      {/* ── 全局搜索命令面板 (Ctrl+K) ── */}
      <CommandPalette />

      {/* ── 首次使用引导向导(检测: 无班级且未完成引导) ── */}
      <OnboardingWizard />
    </div>
  )
}
