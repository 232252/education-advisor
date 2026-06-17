// =============================================================
// 主布局 — 侧边栏导航 + 内容区
// =============================================================

import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ROUTES } from '../hooks/useNavigation'
import { usePrivacyFilter } from '../hooks/usePrivacyFilter'
import { useT } from '../i18n'
import { getAPI } from '../lib/ipc-client'
import { useAgentStore } from '../stores/agentStore'
import { useApprovalStore } from '../stores/approvalStore'
import { toast } from '../stores/toastStore'

const NAV_ITEMS = [
  { path: ROUTES.dashboard, icon: '\u{1F4CA}', labelKey: 'nav.dashboard' },
  { path: ROUTES.chat, icon: '\u{1F4AC}', labelKey: 'nav.chat' },
  { path: ROUTES.students, icon: '\u{1F465}', labelKey: 'nav.students' },
  { path: ROUTES.agents, icon: '\u{1F916}', labelKey: 'nav.agents' },
  // P6: 跨 Agent 执行历史全局页面
  { path: ROUTES.agentHistory, icon: '\u{1F4CB}', labelKey: 'nav.agentHistory' },
  { path: ROUTES.models, icon: '\u{1F9E0}', labelKey: 'nav.models' },
  { path: ROUTES.skills, icon: '\u{1F4DD}', labelKey: 'nav.skills' },
  { path: ROUTES.scheduler, icon: '\u{23F0}', labelKey: 'nav.scheduler' },
  { path: ROUTES.privacy, icon: '\u{1F512}', labelKey: 'nav.privacy' },
  { path: ROUTES.settings, icon: '\u{2699}\u{FE0F}', labelKey: 'nav.settings' },
] as const

export function MainLayout() {
  const { t } = useT()
  const agents = useAgentStore((s) => s.agents)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const initStatusListener = useAgentStore((s) => s.initStatusListener)
  const initApprovalListeners = useApprovalStore((s) => s.initListeners)

  // P1-6: 隐私引擎状态徽章 — 实时反映当前是否脱敏
  const { enabled: privacyEnabled, initialized: privacyInitialized } = usePrivacyFilter()

  useEffect(() => {
    fetchAgents()
    // 初始化 Agent 状态推送监听器（修复:原代码未调用导致实时状态不更新）
    initStatusListener()
    // 初始化 HITL 审批监听器
    initApprovalListeners()
    // Guardrail 拦截事件 — toast 提示
    const unsubGuardrail = getAPI().agent.onGuardrailBlock((ev) => {
      toast.error(`Guardrail 拦截 [${ev.guardrail}] ${ev.reason}`)
    })
    return () => {
      unsubGuardrail()
    }
  }, [fetchAgents, initStatusListener, initApprovalListeners])

  return (
    <div className="flex h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700">
          <span className="text-lg font-bold tracking-tight">Education Advisor</span>
          {/* P1-6: 隐私状态徽章 — 点击跳转 PrivacyPage */}
          <NavLink
            to="/privacy"
            title={
              privacyInitialized
                ? privacyEnabled
                  ? '隐私已启用（点击管理）'
                  : '隐私未启用（点击启用）'
                : '加载中…'
            }
            className="flex items-center"
          >
            <span
              data-testid="privacy-badge"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors
                ${
                  !privacyInitialized
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    : privacyEnabled
                      ? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !privacyInitialized
                    ? 'bg-gray-400'
                    : privacyEnabled
                      ? 'bg-green-500 animate-pulse'
                      : 'bg-gray-400'
                }`}
              />
              🛡️ {privacyEnabled ? 'ON' : 'OFF'}
            </span>
          </NavLink>
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
            {agents.map((agent) => (
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
