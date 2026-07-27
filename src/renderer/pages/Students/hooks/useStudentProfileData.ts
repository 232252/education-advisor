// =============================================================
// useStudentProfileData — 学生档案多源并行加载 hook
// 封装原 StudentProfile.loadAllData 的 Promise.allSettled + currentNameRef
// stale guard 样板，接入 Phase 1 的 useMultiLoader。
//
// 并行的 5 个请求：
//   - eaa.score(name)        → EAAStudentScore
//   - eaa.history(name)      → EAAHistoryData
//   - eaa.codes()            → EAAReasonCode[]   (从 {codes} 解包)
//   - agent.list()           → AgentListItem[]    (注意：无 {success} 包裹)
//   - profile.get(name)      → StudentProfileData (从 {success,data} 解包)
//
// 行为保持与原 loadAllData 一致：
//   1. studentName 变化时重载，旧请求结果由 useMultiLoader 的 token guard 丢弃，
//      替代原 currentNameRef 手动守卫
//   2. 单个请求失败（rejected 或 {success:false}）不影响其他请求（Promise.allSettled 语义）
//   3. 失败的 key 保持上一次的值不变 —— fetcher 在 !success 时 throw，
//      useMultiLoader 会把 throw 记入 errors 但不更新该 key（{...data} 基线保留旧值）
//   4. 失败仅通过 errors 暴露（原代码仅 console.warn，不弹 toast）
// =============================================================

import type {
  AgentListItem,
  EAAHistoryData,
  EAAReasonCode,
  EAAStudentScore,
  StudentProfileData,
} from '@shared/types'
import { useEffect, useState } from 'react'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { getAPI } from '../../../lib/ipc-client'

type StudentProfileLoadedData = {
  score: EAAStudentScore | null
  history: EAAHistoryData | null
  reasonCodes: EAAReasonCode[]
  agents: AgentListItem[]
  profileData: StudentProfileData
}

export interface UseStudentProfileDataResult {
  score: EAAStudentScore | null
  history: EAAHistoryData | null
  reasonCodes: EAAReasonCode[]
  agents: AgentListItem[]
  profileData: StudentProfileData
  /** 并行批次是否仍在进行 */
  loading: boolean
  /** 手动重新加载（刷新按钮 / 添加事件后） */
  reload: () => void
}

export function useStudentProfileData(studentName: string): UseStudentProfileDataResult {
  const { data, loading, reload } = useMultiLoader<StudentProfileLoadedData>(
    {
      // !success 时 throw：useMultiLoader 记入 errors 但不更新该 key，
      // 保留上一次值（与原 loadAllData 的 else-if 分支仅 console.warn 一致）
      score: async () => {
        const result = await getAPI().eaa.score(studentName)
        if (!result.success) throw new Error('score fetch failed')
        return result.data
      },
      history: async () => {
        const result = await getAPI().eaa.history(studentName)
        if (!result.success) throw new Error('history fetch failed')
        return result.data
      },
      reasonCodes: async () => {
        const result = await getAPI().eaa.codes()
        if (!result.success || !result.data?.codes) {
          throw new Error('codes fetch failed')
        }
        return result.data.codes
      },
      // agent.list() 返回 AgentListItem[]，无 {success} 包裹
      agents: async () => {
        return await getAPI().agent.list()
      },
      profileData: async () => {
        const result = await getAPI().profile.get(studentName)
        if (!result.success || !result.data) throw new Error('profile fetch failed')
        return result.data
      },
    },
    // deps: studentName 变化触发重载；useMultiLoader 内部 token guard 丢弃过期结果
    { deps: [studentName] },
  )

  // 保留原 _profileLoaded 语义：批次完成后标记 profile 已尝试加载。
  // 原状态虽然未被读取（前缀 _），但保持等价行为以防下游隐式依赖。
  const [, setProfileLoaded] = useState(false)
  useEffect(() => {
    if (!loading) setProfileLoaded(true)
  }, [loading])

  return {
    score: data.score ?? null,
    history: data.history ?? null,
    reasonCodes: data.reasonCodes ?? [],
    agents: data.agents ?? [],
    profileData: data.profileData ?? {},
    loading,
    reload,
  }
}
