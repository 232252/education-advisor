// =============================================================
// 根组件 — 路由 + 布局（路由级代码分割版）
// =============================================================

import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ContextMenu } from './components/ContextMenu'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastContainer } from './components/ToastContainer'
import { useForwardConsole } from './hooks/useForwardConsole'
import { useTheme } from './hooks/useTheme'
import { MainLayout } from './layouts/MainLayout'

// 路由级懒加载 — 首屏仅加载 MainLayout + DashboardPage
const DashboardPage = lazy(() =>
  import('./pages/Dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const ChatPage = lazy(() => import('./pages/Chat/ChatPage').then((m) => ({ default: m.ChatPage })))
const StudentsPage = lazy(() =>
  import('./pages/Students/StudentsPage').then((m) => ({ default: m.StudentsPage })),
)
const ClassesPage = lazy(() =>
  import('./pages/Classes/ClassesPage').then((m) => ({ default: m.ClassesPage })),
)
const AcademicsPage = lazy(() =>
  import('./pages/Academics/AcademicsPage').then((m) => ({ default: m.AcademicsPage })),
)
const AgentsPage = lazy(() =>
  import('./pages/Agents/AgentsPage').then((m) => ({ default: m.AgentsPage })),
)
const ModelsPage = lazy(() =>
  import('./pages/Models/ModelsPage').then((m) => ({ default: m.ModelsPage })),
)
const SkillsPage = lazy(() =>
  import('./pages/Skills/SkillsPage').then((m) => ({ default: m.SkillsPage })),
)
const SchedulerPage = lazy(() =>
  import('./pages/Scheduler/SchedulerPage').then((m) => ({ default: m.SchedulerPage })),
)
const PrivacyPage = lazy(() =>
  import('./pages/Privacy/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const WelcomePage = lazy(() =>
  import('./pages/Welcome/WelcomePage').then((m) => ({ default: m.WelcomePage })),
)

/** 路由懒加载时的骨架屏 */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-full animate-fade-in">
      <div className="space-y-3 p-6 w-full max-w-2xl">
        <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-4 w-1/3" />
        <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-8 w-1/2" />
        <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-3 w-2/3" />
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="animate-pulse rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-[#1a1e28] p-5 space-y-3">
            <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-4 w-1/3" />
            <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-8 w-1/2" />
          </div>
          <div className="animate-pulse rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-[#1a1e28] p-5 space-y-3">
            <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-4 w-1/3" />
            <div className="animate-pulse rounded-md bg-gray-200 dark:bg-white/[0.06] h-8 w-1/2" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function App() {
  // 初始化主题（dark/light/system）
  useTheme()
  // T2: 装 console 劫持 hook,所有 console 输出转发到 logs/renderer-*.log
  useForwardConsole()

  return (
    <ErrorBoundary>
      <HashRouter>
        {/* P2-8: 全局 toast 通知容器,挂载在 Router 之外,跨页面保持 */}
        <ToastContainer />
        {/* 桌面级自定义右键菜单,替代浏览器默认右键 */}
        <ContextMenu />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* 根路径直接进入系统，/welcome 保留给想看介绍视频的用户 */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route element={<MainLayout />}>
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/classes" element={<ClassesPage />} />
              <Route path="/academics" element={<AcademicsPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/scheduler" element={<SchedulerPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {/* 兜底：未匹配路由重定向到 dashboard，避免空白页 */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </ErrorBoundary>
  )
}
