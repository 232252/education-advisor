// =============================================================
// useNavigation — P4 跨页面导航 Hook
// 集中管理页面跳转逻辑,所有跳转都通过此 hook (类型安全 + 可观察)
//
// 用法:
//   const { goToStudent, goToDashboard, goToAgent, goToSkill, buildStudentHref } = useNavigation()
//   goToStudent('G123')                  // 立即跳转并打开详情
//   const href = buildStudentHref('G123') // 生成链接,用于 <a href> / <Link to>
//
// 目标:
//   1. 避免散落在页面里的 navigate('/students?entity_id=...') 字符串
//   2. URL 参数变化 (entity_id) 集中处理
//   3. 未来若需埋点 / 通知 / 权限校验,加在 hook 里即可
// =============================================================

import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

/** 已知的内部路由常量 (与 App.tsx 保持同步) */
export const ROUTES = {
  dashboard: '/dashboard',
  chat: '/chat',
  students: '/students',
  agents: '/agents',
  // P6: 跨 Agent 执行历史全局页面
  agentHistory: '/agents/history',
  models: '/models',
  skills: '/skills',
  scheduler: '/scheduler',
  privacy: '/privacy',
  settings: '/settings',
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]

export interface UseNavigationResult {
  /** 跳转到指定路由(可附加 search) */
  goTo: (path: string, search?: Record<string, string>) => void
  /** 跳转到 Dashboard 主页 */
  goToDashboard: () => void
  /** 跳转到 Students 列表;若传 entityId 则自动打开该学生详情 */
  goToStudent: (entityId: string, options?: { tab?: 'profile' | 'academic' | 'events' }) => void
  /** 跳转到指定 Agent 详情 */
  goToAgent: (agentId: string) => void
  /** 跳转到指定 Skill 详情 */
  goToSkill: (skillName: string) => void
  /** 跳转到 Chat(可携带初始 prompt) */
  goToChat: (initialPrompt?: string) => void
  /** 跳转到 Privacy 设置 */
  goToPrivacy: () => void
  /** 生成 /students?entity_id=... 链接(用于 <Link to>) */
  buildStudentHref: (
    entityId: string,
    options?: { tab?: 'profile' | 'academic' | 'events' },
  ) => string
  /** 生成 /agents?agent_id=... 链接 */
  buildAgentHref: (agentId: string) => string
  /** 生成 /skills?name=... 链接 */
  buildSkillHref: (skillName: string) => string
  /** 读取当前 URL search params (如 ?entity_id=, ?tab=) */
  searchParams: URLSearchParams
  /** 读取指定 search param,无值返回 null */
  getSearchParam: (key: string) => string | null
}

export function useNavigation(): UseNavigationResult {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const goTo = useCallback(
    (path: string, search?: Record<string, string>) => {
      const params = new URLSearchParams()
      if (search) {
        for (const [k, v] of Object.entries(search)) {
          if (typeof v === 'string' && v.length > 0) params.set(k, v)
        }
      }
      const qs = params.toString()
      const fullPath = qs.length > 0 ? `${path}?${qs}` : path
      navigate(fullPath)
    },
    [navigate],
  )

  const buildStudentHref = useCallback(
    (entityId: string, options?: { tab?: 'profile' | 'academic' | 'events' }) => {
      const search: Record<string, string> = { entity_id: entityId }
      if (options?.tab) search.tab = options.tab
      const qs = new URLSearchParams(search).toString()
      return `${ROUTES.students}?${qs}`
    },
    [],
  )

  const buildAgentHref = useCallback((agentId: string) => {
    return `${ROUTES.agents}?agent_id=${encodeURIComponent(agentId)}`
  }, [])

  const buildSkillHref = useCallback((skillName: string) => {
    return `${ROUTES.skills}?name=${encodeURIComponent(skillName)}`
  }, [])

  const goToStudent = useCallback(
    (entityId: string, options?: { tab?: 'profile' | 'academic' | 'events' }) => {
      navigate(buildStudentHref(entityId, options))
    },
    [navigate, buildStudentHref],
  )

  const goToAgent = useCallback(
    (agentId: string) => {
      navigate(buildAgentHref(agentId))
    },
    [navigate, buildAgentHref],
  )

  const goToSkill = useCallback(
    (skillName: string) => {
      navigate(buildSkillHref(skillName))
    },
    [navigate, buildSkillHref],
  )

  const goToChat = useCallback(
    (initialPrompt?: string) => {
      const search: Record<string, string> = {}
      if (initialPrompt) search.prompt = initialPrompt
      goTo(ROUTES.chat, search)
    },
    [goTo],
  )

  const goToDashboard = useCallback(() => navigate(ROUTES.dashboard), [navigate])
  const goToPrivacy = useCallback(() => navigate(ROUTES.privacy), [navigate])

  const getSearchParam = useCallback((key: string) => searchParams.get(key), [searchParams])

  return {
    goTo,
    goToDashboard,
    goToStudent,
    goToAgent,
    goToSkill,
    goToChat,
    goToPrivacy,
    buildStudentHref,
    buildAgentHref,
    buildSkillHref,
    searchParams,
    getSearchParam,
  }
}
