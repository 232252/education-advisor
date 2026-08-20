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
import { t } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { useClassStore } from '../../../stores/class/store'
import { useStudentStore } from '../../../stores/student/store'
import { toast } from '../../../stores/toastStore'

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
      // 拉全量排行(不传 n), 由前端按班级过滤后再 slice(0,10) 展示。
      // 修复: 之前 ranking(10) 只取全校前10, 班级过滤在 top10 之外的学生全部丢失,
      // 导致"班级对比/班级筛选看不到数据"(数据越多越明显)。
      const r = await getAPI().eaa.ranking()
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
      // M20: 复用共享 studentStore — 与 Students/Classes/Academics 跨页共享(TTL 3s)
      const students = await useStudentStore.getState().fetchStudents()
      return students.filter((s) => s.status !== 'Deleted')
    },
    classList: async (): Promise<ClassEntity[]> => {
      // M20: 复用共享 classStore
      return useClassStore.getState().fetchClasses()
    },
    allEvents: async (): Promise<EAAEventRecord[]> => {
      const r = await getAPI().eaa.range(
        new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        new Date().toISOString().slice(0, 10),
        5000,
      )
      // M10: range 结果达上限(limit 被截断为 1000)时提醒缩小日期范围
      if (r.success && r.data?.truncated) {
        toast.warning(t('toast.eaa.rangeTruncated'))
      }
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
