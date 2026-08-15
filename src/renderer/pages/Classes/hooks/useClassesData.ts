// =============================================================
// 班级数据加载 hook — 班级列表 + 学生数统计（EAA 异步不阻塞）
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

/** 学生数统计：class_id → 人数 */
export type ClassCountMap = Record<string, number>

/** 加载班级列表与学生数统计（含卸载保护） */
export function useClassesData() {
  const { t } = useT()
  const [classes, setClasses] = useState<ClassEntity[]>([])
  const [allStudents, setAllStudents] = useState<EAAStudent[]>([])
  const [counts, setCounts] = useState<ClassCountMap>({})
  const [loading, setLoading] = useState(true)

  // M-8 修复: mountedRef 用于异步加载的卸载保护
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadClasses = useCallback(async () => {
    setLoading(true)
    try {
      // 先加载班级列表 (本地 DB, 极快), 立即显示
      const clsRes = await getAPI().class.list()
      // M-8 修复: 卸载保护
      if (!mountedRef.current) return
      if (clsRes.success && clsRes.data) setClasses(clsRes.data)
      // 异步加载学生列表 (EAA spawn 较慢), 加载完后更新学生数
      // 不阻塞班级列表的显示
      getAPI()
        .eaa.listStudents()
        .then((stuRes) => {
          if (!mountedRef.current) return
          const students = stuRes.data?.students ?? []
          setAllStudents(students)
          const map: ClassCountMap = {}
          for (const s of students) {
            if (s.class_id) map[s.class_id] = (map[s.class_id] ?? 0) + 1
          }
          setCounts(map)
        })
        .catch((err) => {
          console.warn('[Classes] Failed to load students:', err)
        })
    } catch (err) {
      if (!mountedRef.current) return
      console.error('[Classes] load failed:', err)
      toast.error(t('toast.students.loadClassFailed'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadClasses()
  }, [loadClasses])

  return { classes, allStudents, counts, loading, loadClasses }
}
