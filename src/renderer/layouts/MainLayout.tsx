// =============================================================
// 主布局 — 侧边栏导航 + 内容区
// =============================================================

import {
  Blocks,
  Bot,
  Brain,
  CalendarClock,
  GraduationCap,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  NotebookPen,
  PanelLeft,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AppLogo } from '../components/AppLogo'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ThemeToggle } from '../components/ThemeToggle'
import { useT } from '../i18n'
import { cn } from '../lib/ui-utils'
import { useAgentStore } from '../stores/agentStore'

/** localStorage key for sidebar collapsed state */
const SIDEBAR_COLLAPSED_KEY = 'ea.sidebar.collapsed'

interface NavItem {
  path: string
  icon: LucideIcon
  labelKey: string
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { path: '/chat', icon: MessageSquare, labelKey: 'nav.chat' },
  { path: '/students', icon: Users, labelKey: 'nav.students' },
  { path: '/classes', icon: GraduationCap, labelKey: 'nav.classes' },
  { path: '/academics', icon: NotebookPen, labelKey: 'nav.academics' },
  { path: '/agents', icon: Bot, labelKey: 'nav.agents' },
  { path: '/models', icon: Brain, labelKey: 'nav.models' },
  { path: '/skills', icon: Blocks, labelKey: 'nav.skills' },
  { path: '/scheduler', icon: CalendarClock, labelKey: 'nav.scheduler' },
  { path: '/privacy', icon: ShieldCheck, labelKey: 'nav.privacy' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
]

export function MainLayout() {
  const { t } = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const agents = useAgentStore((s) => s.agents)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const initStatusListener = useAgentStore((s) => s.initStatusListener)

  // 可折叠侧边栏: 状态持久化到 localStorage, 折叠后只显示图标列
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* localStorage 不可用时静默降级 */
      }
      return next
    })
  }, [])

  useEffect(() => {
    fetchAgents()
    initStatusListener()
  }, [fetchAgents, initStatusListener])

  // 桌面级全局快捷键:
  //   Ctrl/Cmd+1..9 → 切换前 9 个导航项
  //   Ctrl/Cmd+,    → 设置(业界惯例)
  //   Ctrl/Cmd+B    → 折叠/展开侧边栏(VS Code/JetBrains 惯例)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      // 输入框/文本域/可编辑元素聚焦时不触发(避免影响打字)
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (target?.isContentEditable) return
      // Ctrl/Cmd+, → 设置(业界惯例)
      if (e.key === ',') {
        e.preventDefault()
        navigate('/settings')
        return
      }
      // Ctrl/Cmd+B → 折叠/展开侧边栏
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        toggleCollapsed()
        return
      }
      // Ctrl/Cmd+1..9 → 对应导航项
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= 9 && NAV_ITEMS[n - 1]) {
        e.preventDefault()
        navigate(NAV_ITEMS[n - 1].path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, toggleCollapsed])

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
        <div
          className={cn(
            'border-t border-gray-200/60 dark:border-white/[0.06]',
            collapsed ? 'px-2 py-3' : 'px-4 py-3',
          )}
        >
          {!collapsed && (
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest font-semibold">
                {t('sidebar.agents', 'Agents')}
              </span>
              {runningCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded-full ring-1 ring-blue-500/20">
                  <span className="w-1 h-1 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                  {runningCount} {t('sidebar.running', '运行中')}
                </span>
              )}
            </div>
          )}
          <div
            className={cn(
              'max-h-28 overflow-y-auto',
              collapsed ? 'space-y-2 flex flex-col items-center' : 'space-y-1.5',
            )}
          >
            {agents.slice(0, 6).map((agent) => (
              <div
                key={agent.id}
                className={cn('flex items-center text-xs group', collapsed ? 'gap-0' : 'gap-2.5')}
                title={collapsed ? `${agent.name} · ${agent.status}` : undefined}
              >
                <span
                  className={cn(
                    'rounded-full flex-shrink-0 transition-all duration-300',
                    collapsed ? 'w-2 h-2' : 'w-1.5 h-1.5',
                    agent.status === 'running' &&
                      'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.6)] animate-pulse',
                    agent.status === 'error' && 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]',
                    agent.status === 'idle' && 'bg-gray-300 dark:bg-gray-600',
                  )}
                />
                {!collapsed && (
                  <span className="text-gray-500 dark:text-gray-400 truncate group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-150">
                    {agent.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 主题切换 */}
        <div
          className={cn(
            'border-t border-gray-200/60 dark:border-white/[0.06]',
            collapsed ? 'p-2 flex justify-center' : 'p-3',
          )}
        >
          <ThemeToggle />
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
    </div>
  )
}
