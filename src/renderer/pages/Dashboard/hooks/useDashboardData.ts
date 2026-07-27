// =============================================================
// useDashboardData — Dashboard 数据加载
// 封装原 DashboardPage 的 8 个 Promise.allSettled 并行加载 + setState 样板。
// 设计：使用 useMultiLoader，fetcher 在本层解包 {success, data?}。
// =============================================================

import type {
  ClassEntity,
  EAAEventRecord,
  EAAInfoData,
  EAARankItem,
  EAAStatsData,
  EAAStudent,
  EAASummaryData,
  EAATagListData,
} from '@shared/types'
import { useMemo } from 'react'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { getAPI } from '../../../lib/ipc-client'

export function useDashboardData() {
  const { data, loading, errors, reload } = useMultiLoader({
    stats: async (): Promise<EAAStatsData | null> => {
      const r = await getAPI().eaa.stats()
      return r.success && r.data ? r.data : null
    },
    summary: async (): Promise<EAASummaryData | null> => {
      const r = await getAPI().eaa.summary()
      return r.success && r.data ? r.data : null
    },
    ranking: async (): Promise<EAARankItem[]> => {
      const r = await getAPI().eaa.ranking(10)
      return r.success && r.data?.ranking ? r.data.ranking : []
    },
    eaaInfo: async (): Promise<EAAInfoData | null> => {
      const r = await getAPI().eaa.info()
      return r.success && r.data ? r.data : null
    },
    tagData: async (): Promise<EAATagListData | null> => {
      const r = await getAPI().eaa.tag()
      // 保留原 isTagListData 类型守卫语义
      if (r.success && r.data && Array.isArray((r.data as EAATagListData).tags)) {
        return r.data as EAATagListData
      }
      return null
    },
    allStudents: async (): Promise<EAAStudent[]> => {
      const r = await getAPI().eaa.listStudents()
      return r.success && r.data?.students
        ? r.data.students.filter((s) => s.status !== 'Deleted')
        : []
    },
    classList: async (): Promise<ClassEntity[]> => {
      const r = await getAPI().class.list()
      return r.success && r.data ? r.data : []
    },
    allEvents: async (): Promise<EAAEventRecord[]> => {
      const r = await getAPI().eaa.range(
        new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        new Date().toISOString().slice(0, 10),
        5000,
      )
      return r.success && r.data?.events ? r.data.events : []
    },
  })

  const resolved = useMemo(
    () => ({
      stats: data.stats ?? null,
      summary: data.summary ?? null,
      ranking: data.ranking ?? [],
      eaaInfo: data.eaaInfo ?? null,
      tagData: data.tagData ?? null,
      allStudents: data.allStudents ?? [],
      classList: data.classList ?? [],
      allEvents: data.allEvents ?? [],
    }),
    [data],
  )

  return { ...resolved, loading, errors, reload }
}
