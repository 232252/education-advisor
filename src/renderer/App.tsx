// =============================================================
// 根组件 — 路由 + 布局
// =============================================================

import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ToastContainer } from './components/ToastContainer'
import { useForwardConsole } from './hooks/useForwardConsole'
import { useTheme } from './hooks/useTheme'
import { MainLayout } from './layouts/MainLayout'
import { AgentsPage } from './pages/Agents/AgentsPage'
import { ChatPage } from './pages/Chat/ChatPage'
import { ClassesPage } from './pages/Classes/ClassesPage'
import { DashboardPage } from './pages/Dashboard/DashboardPage'
import { ModelsPage } from './pages/Models/ModelsPage'
import { PrivacyPage } from './pages/Privacy/PrivacyPage'
import { SchedulerPage } from './pages/Scheduler/SchedulerPage'
import { SettingsPage } from './pages/Settings/SettingsPage'
import { SkillsPage } from './pages/Skills/SkillsPage'
import { StudentsPage } from './pages/Students/StudentsPage'

export function App() {
  // 初始化主题（dark/light/system）
  useTheme()
  // T2: 装 console 劫持 hook,所有 console 输出转发到 logs/renderer-*.log
  useForwardConsole()

  return (
    <HashRouter>
      {/* P2-8: 全局 toast 通知容器,挂载在 Router 之外,跨页面保持 */}
      <ToastContainer />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/classes" element={<ClassesPage />} />
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
    </HashRouter>
  )
}
