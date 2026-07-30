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
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ThemeToggle } from '../components/ThemeToggle'
import { useT } from '../i18n'
import { cn } from '../lib/ui-utils'
import { useAgentStore } from '../stores/agentStore'

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
  const agents = useAgentStore((s) => s.agents)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const initStatusListener = useAgentStore((s) => s.initStatusListener)

  useEffect(() => {
    fetchAgents()
    initStatusListener()
  }, [fetchAgents, initStatusListener])

  const runningCount = agents.filter((a) => a.status === 'running').length

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 dark:bg-surface-primary dark:text-gray-100">
      {/* ── 侧边栏 ── */}
      <aside className="w-60 flex-shrink-0 border-r border-gray-200/60 dark:border-white/[0.06] flex flex-col bg-white/80 dark:bg-surface-secondary/90 backdrop-blur-xl">
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-gray-200/60 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-blue-500/25 ring-1 ring-white/30 dark:ring-white/10">
              E
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-surface-secondary" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
                {t('app.name', 'Education Advisor')}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">
                {t('app.tagline', '智能教育管理助手')}
              </span>
            </div>
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg transition-all duration-200',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-500/[0.12] text-blue-700 dark:text-blue-400 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.15)]'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.05] hover:text-gray-800 dark:hover:text-gray-200',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* 左侧高亮指示条 — 激活时显示 */}
                    <span
                      className={cn(
                        'absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-blue-500 dark:bg-blue-400 transition-all duration-200',
                        isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0',
                      )}
                      aria-hidden="true"
                    />
                    <Icon
                      size={19}
                      strokeWidth={isActive ? 2.4 : 2.0}
                      className="flex-shrink-0 transition-all duration-200"
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Agent 状态 */}
        <div className="border-t border-gray-200/60 dark:border-white/[0.06] px-4 py-3">
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
          <div className="space-y-1.5 max-h-28 overflow-y-auto">
            {agents.slice(0, 6).map((agent) => (
              <div key={agent.id} className="flex items-center gap-2.5 text-xs group">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-300',
                    agent.status === 'running' &&
                      'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.6)] animate-pulse',
                    agent.status === 'error' && 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]',
                    agent.status === 'idle' && 'bg-gray-300 dark:bg-gray-600',
                  )}
                />
                <span className="text-gray-500 dark:text-gray-400 truncate group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-150">
                  {agent.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 主题切换 */}
        <div className="border-t border-gray-200/60 dark:border-white/[0.06] p-3">
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
