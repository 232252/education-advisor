// =============================================================
// useAcademicsData — 学业页初始并行加载 (students / classList / config / exams)
//
// 封装 useMultiLoader + IPC {success, data?} 解包逻辑，消除
// AcademicsPage 里原本手写的 Promise.allSettled 样板。
//
// 注意：
//   - grades 加载是按需触发的（依赖 selectedStudent），
//     不在此 hook 内统一加载；保持 useMultiLoader 只做"挂载即拉"的初始并行 fetch。
//     grades 由 AcademicsPage 自身的 loadGrades + useEffect 维护。
//   - useMultiLoader 不调用 toast；原 loadInitialData 里有 toast.error
//     兜底，迁移后改为通过 errors 暴露（与 hook 设计一致）。
// =============================================================

import type { AcademicConfig, ClassEntity, EAAStudent, ExamDef } from '@shared/types'
import { useMemo } from 'react'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { getAPI } from '../../../lib/ipc-client'
import { useClassStore } from '../../../stores/class/store'
import { useStudentStore } from '../../../stores/student/store'

interface AcademicsInitialData {
  students: EAAStudent[]
  classList: ClassEntity[]
  config: AcademicConfig | null
  exams: ExamDef[]
}

interface UseAcademicsDataResult {
  data: AcademicsInitialData
  loading: boolean
  reload: () => void
}

/** useMultiLoader fetcher 解包 IPC 结果；失败时 fetcher 抛错，由 hook 记入 errors */
async function unwrapStudents(): Promise<EAAStudent[]> {
  // M20: 复用共享 studentStore — 与 Students/Classes/Dashboard 跨页共享(TTL 3s)
  const students = await useStudentStore.getState().fetchItems()
  return students.filter((s) => s.status !== 'Deleted')
}

async function unwrapClassList(): Promise<ClassEntity[]> {
  // M20: 复用共享 classStore
  return useClassStore.getState().fetchItems()
}

async function unwrapConfig(): Promise<AcademicConfig | null> {
  const res = await getAPI().academic.getConfig()
  if (res.success && res.data) return res.data
  return null
}

async function unwrapExams(): Promise<ExamDef[]> {
  const res = await getAPI().academic.listExams()
  if (res.success && res.data) return res.data
  return []
}

const FALLBACKS = {
  students: [] as EAAStudent[],
  classList: [] as ClassEntity[],
  config: null as AcademicConfig | null,
  exams: [] as ExamDef[],
}

export function useAcademicsData(): UseAcademicsDataResult {
  const fetchers = useMemo(
    () => ({
      students: unwrapStudents,
      classList: unwrapClassList,
      config: unwrapConfig,
      exams: unwrapExams,
    }),
    [],
  )

  const { data, loading, reload } = useMultiLoader(fetchers, { deps: [], fallbacks: FALLBACKS })

  return { data: data as AcademicsInitialData, loading, reload }
}
