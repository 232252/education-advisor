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
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { t } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { todayISO } from '../../../lib/ui-utils'
import { useClassStore } from '../../../stores/class/store'
import { useStudentStore } from '../../../stores/student/store'
import { toast } from '../../../stores/toastStore'

/** 各数据源兜底(模块级常量保引用稳定,避免下游 useMemo 被击穿) */
const FALLBACKS = {
  stats: null as EAAStatsData | null,
  summary: null as EAASummaryData | null,
  ranking: [] as EAARankItem[],
  eaaInfo: null as EAAInfoData | null,
  tagData: null as EAATagListData | null,
  allStudents: [] as EAAStudent[],
  classList: [] as ClassEntity[],
  allEvents: [] as EAAEventRecord[],
}

// 截断提醒每次会话只弹一次:180 天窗口在数据量大的库里必然触发上限,
// 每次进仪表盘都弹会变成噪声(用户无可操作的日期控件)。
let rangeTruncationWarned = false

export function useDashboardData() {
  const { data, loading, errors, readyKeys, reload } = useMultiLoader(
    {
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
        const students = await useStudentStore.getState().fetchItems()
        return students.filter((s) => s.status !== 'Deleted')
      },
      classList: async (): Promise<ClassEntity[]> => {
        // M20: 复用共享 classStore
        return useClassStore.getState().fetchItems()
      },
      allEvents: async (): Promise<EAAEventRecord[]> => {
        const r = await getAPI().eaa.range(
          new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
          todayISO(),
          5000,
        )
        // M10: range 结果达上限(limit 被截断为 1000)时提醒缩小日期范围(每会话一次)
        if (r.success && r.data?.truncated && !rangeTruncationWarned) {
          rangeTruncationWarned = true
          toast.warning(t('toast.eaa.rangeTruncated'))
        }
        return r.success && r.data?.events ? r.data.events : []
      },
      // fallbacks 模式: 未加载/失败 key 直接落兜底,删除原 resolved 归一化 useMemo
    },
    { fallbacks: FALLBACKS },
  )
  // 泛型 T 直接展开会产生可选属性,经具体类型转一道恢复必选
  const resolved = data as typeof FALLBACKS

  return { ...resolved, loading, errors, readyKeys, reload }
}
