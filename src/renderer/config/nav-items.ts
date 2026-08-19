// =============================================================
// nav-items — 侧边栏/命令面板共用的导航项配置
// 单一数据源: MainLayout 侧边栏渲染 + 命令面板页面跳转搜索。
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

export interface NavItem {
  path: string
  icon: LucideIcon
  labelKey: string
  /** 命令面板搜索用的额外关键词(拼音/英文) */
  keywords?: string
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/dashboard',
    icon: LayoutDashboard,
    labelKey: 'nav.dashboard',
    keywords: 'dashboard home 仪表盘',
  },
  { path: '/chat', icon: MessageSquare, labelKey: 'nav.chat', keywords: 'chat talk 对话' },
  { path: '/students', icon: Users, labelKey: 'nav.students', keywords: 'students 学生' },
  { path: '/classes', icon: GraduationCap, labelKey: 'nav.classes', keywords: 'classes 班级' },
  {
    path: '/academics',
    icon: NotebookPen,
    labelKey: 'nav.academics',
    keywords: 'academics grades 成绩 学业',
  },
  { path: '/agents', icon: Bot, labelKey: 'nav.agents', keywords: 'agents 智能体' },
  { path: '/models', icon: Brain, labelKey: 'nav.models', keywords: 'models 模型' },
  { path: '/skills', icon: Blocks, labelKey: 'nav.skills', keywords: 'skills 技能 mcp' },
  {
    path: '/scheduler',
    icon: CalendarClock,
    labelKey: 'nav.scheduler',
    keywords: 'scheduler cron 定时',
  },
  { path: '/privacy', icon: ShieldCheck, labelKey: 'nav.privacy', keywords: 'privacy 隐私' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings', keywords: 'settings 设置' },
]
