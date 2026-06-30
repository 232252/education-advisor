// =============================================================
// 主布局 — 侧边栏导航 + 内容区
// =============================================================

import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useT } from '../i18n'
import { useAgentStore } from '../stores/agentStore'

const NAV_ITEMS = [
  { path: '/dashboard', icon: '\u{1F4CA}', labelKey: 'nav.dashboard' },
  { path: '/chat', icon: '\u{1F4AC}', labelKey: 'nav.chat' },
  { path: '/students', icon: '\u{1F465}', labelKey: 'nav.students' },
  { path: '/classes', icon: '\u{1F393}', labelKey: 'nav.classes' },
  { path: '/agents', icon: '\u{1F916}', labelKey: 'nav.agents' },
  { path: '/models', icon: '\u{1F9E0}', labelKey: 'nav.models' },
  { path: '/skills', icon: '\u{1F4DD}', labelKey: 'nav.skills' },
  { path: '/scheduler', icon: '\u{23F0}', labelKey: 'nav.scheduler' },
  { path: '/privacy', icon: '\u{1F512}', labelKey: 'nav.privacy' },
  { path: '/settings', icon: '\u{2699}\u{FE0F}', labelKey: 'nav.settings' },
] as const

export function MainLayout() {
  const { t } = useT()
  const agents = useAgentStore((s) => s.agents)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const initStatusListener = useAgentStore((s) => s.initStatusListener)

  useEffect(() => {
    fetchAgents()
    // 初始化 Agent 状态推送监听器（修复:原代码未调用导致实时状态不更新）
    initStatusListener()
  }, [fetchAgents, initStatusListener])

  return (
    <div className="flex h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-gray-200 dark:border-gray-700">
          <span className="text-lg font-bold tracking-tight">Education Advisor</span>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset
                ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider">
            {t('page.agents.title')} <span className="normal-case">· {t('common.refresh')}</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {agents.slice(0, 6).map((agent) => (
              <div key={agent.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-2 h-2 rounded-full
                    ${agent.status === 'running' ? 'bg-blue-400 animate-pulse' : ''}
                    ${agent.status === 'error' ? 'bg-red-400' : ''}
                    ${agent.status === 'idle' ? 'bg-gray-400 dark:bg-gray-500' : ''}
                  `}
                />
                <span className="text-gray-500 dark:text-gray-400 truncate">{agent.name}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
