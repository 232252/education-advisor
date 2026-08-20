// =============================================================
// 班级数据加载 hook — 班级列表 + 学生数统计（EAA 异步不阻塞）
//
// M20: 班级/学生数据改走共享 store(stores/class + stores/student):
//   - classes ← classStore(建班/存档/删除后 loadClasses force 刷新)
//   - allStudents/counts ← studentStore 原始全量(含 Deleted,与原行为一致)
// 学生加载不阻塞班级列表显示(loading 仅跟踪班级,与原实现一致)。
// 原 mountedRef 卸载保护不再需要 — 写入的是 store 而非组件 state。
// 本 hook 对外 API 不变 — ClassesPage 零改动。
// =============================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useT } from '../../../i18n'
import { useClassStore } from '../../../stores/class/store'
import { useStudentStore } from '../../../stores/student/store'
import { toast } from '../../../stores/toastStore'

/** 学生数统计：class_id → 人数 */
export type ClassCountMap = Record<string, number>

/** 加载班级列表与学生数统计（学生数随共享 store 数据到达自动更新） */
export function useClassesData() {
  const { t } = useT()
  const classes = useClassStore((s) => s.classes)
  const classesLoading = useClassStore((s) => s.loading)
  const classesSettled = useClassStore((s) => s.settled)
  const classesError = useClassStore((s) => s.error)
  // 原始全量学生(含 Deleted) — 人数统计口径与原实现一致
  const allStudents = useStudentStore((s) => s.students)

  // 班级加载异常提示(与原行为一致: 仅 IPC 异常 toast)
  const lastErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (classesError && classesError !== lastErrorRef.current) {
      toast.error(t('toast.students.loadClassFailed'))
    }
    lastErrorRef.current = classesError
  }, [classesError, t])

  // 页面重载(挂载/班级变更后): 班级 force 刷新;
  // 学生非强制 — TTL 内复用其他页刚拉的数据,过期则后台重拉(不阻塞班级显示)
  const loadClasses = useCallback(async () => {
    await Promise.all([
      useClassStore.getState().fetchClasses({ force: true }),
      useStudentStore.getState().fetchStudents(),
    ])
  }, [])

  useEffect(() => {
    loadClasses()
  }, [loadClasses])

  // 学生数统计: class_id → 人数(store 数据到达后自动重算)
  const counts = useMemo(() => {
    const map: ClassCountMap = {}
    for (const s of allStudents) {
      if (s.class_id) map[s.class_id] = (map[s.class_id] ?? 0) + 1
    }
    return map
  }, [allStudents])

  const loading = classesLoading || !classesSettled

  return { classes, allStudents, counts, loading, loadClasses }
}
