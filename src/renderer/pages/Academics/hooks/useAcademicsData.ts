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

export interface AcademicsInitialData {
  students: EAAStudent[]
  classList: ClassEntity[]
  config: AcademicConfig | null
  exams: ExamDef[]
}

export interface UseAcademicsDataResult {
  data: AcademicsInitialData
  loading: boolean
  reload: () => void
}

/** useMultiLoader fetcher 解包 IPC 结果；失败时 fetcher 抛错，由 hook 记入 errors */
async function unwrapStudents(): Promise<EAAStudent[]> {
  // M20: 复用共享 studentStore — 与 Students/Classes/Dashboard 跨页共享(TTL 3s)
  const students = await useStudentStore.getState().fetchStudents()
  return students.filter((s) => s.status !== 'Deleted')
}

async function unwrapClassList(): Promise<ClassEntity[]> {
  // M20: 复用共享 classStore
  return useClassStore.getState().fetchClasses()
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

  const { data, loading, reload } = useMultiLoader(fetchers, { deps: [] })

  const merged: AcademicsInitialData = useMemo(
    () => ({
      students: data.students ?? [],
      classList: data.classList ?? [],
      config: data.config ?? null,
      exams: data.exams ?? [],
    }),
    [data],
  )

  return { data: merged, loading, reload }
}
