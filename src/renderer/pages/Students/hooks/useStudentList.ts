// =============================================================
// useStudentList — 学生列表数据加载域 hook
// 封装 students/classList/loading/exportFormats 状态与
// loadStudents/loadClasses/refreshStudents 加载函数,
// 以及 archivedClassIds/classIdToName/activeClassList 派生数据
// 和 Dashboard 排行榜跳转的 entity_id 自动选中逻辑。
//
// M20: 学生/班级数据改走共享 store(stores/student + stores/class),
// 与 Classes/Dashboard/Academics 四页复用同一份数据(TTL 3s):
// 跨页切换不重复 spawn EAA;Classes 页建班/存档后 Students 页自动刷新。
// 本 hook 对外 API 不变 — StudentsPage 零改动。
// =============================================================

import type { EAAStudent } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useT } from '../../../i18n'
import { buildClassIdToNameMap } from '../../../lib/class-utils'
import { getAPI } from '../../../lib/ipc-client'
import { useClassStore } from '../../../stores/class/store'
import { useStudentStore } from '../../../stores/student/store'
import { toast } from '../../../stores/toastStore'

export function useStudentList(setSelectedStudent: (s: EAAStudent | null) => void) {
  const { t } = useT()
  // 共享 store 订阅(原始数据含 Deleted,本页过滤后展示)
  const rawStudents = useStudentStore((s) => s.students)
  const studentsLoading = useStudentStore((s) => s.loading)
  const studentsSettled = useStudentStore((s) => s.settled)
  const studentsError = useStudentStore((s) => s.error)
  const classList = useClassStore((s) => s.classes)
  // 导出格式：从 EAA 动态获取（fallback 到内置列表）
  // C-2 修复: fallback 列表必须与 EAA Rust 端 cmd_export 一致 (csv/jsonl/html)
  // 之前包含 json 和 markdown,EAA 不支持,选了会报"未知导出格式"错误
  const [exportFormats, setExportFormats] = useState<string[]>(['csv', 'jsonl', 'html'])
  // 从 Dashboard 排行榜跳转时,通过 query param 携带 entity_id 自动选中学生
  const [searchParams, setSearchParams] = useSearchParams()

  // 初始 loading 语义与原实现一致: 首次拉取完成前保持 loading
  const loading = studentsLoading || !studentsSettled
  // 过滤掉已删除学生(status=Deleted,避免软删除学生干扰列表)
  const students = useMemo(() => rawStudents.filter((s) => s.status !== 'Deleted'), [rawStudents])

  // 变更后重载(增删/批量操作后由 useStudentActions 调用):
  // force 绕过渲染层 TTL — 写操作虽已失效主进程缓存,但渲染层 store 仍可能命中旧缓存
  const loadStudents = useCallback(async () => {
    await useStudentStore.getState().fetchStudents({ force: true })
  }, [])

  const loadClasses = useCallback(async () => {
    await useClassStore.getState().fetchClasses({ force: true })
  }, [])

  // 手动刷新：先清空 EAA 读缓存，再强制重新加载（强制重新拉取最新数据）
  const refreshStudents = useCallback(async () => {
    try {
      await getAPI().eaa.invalidateCache()
    } catch {
      /* 清缓存失败不阻塞 */
    }
    await useStudentStore.getState().fetchStudents({ force: true })
  }, [])

  // 挂载: 非强制拉取 — TTL(3s)内复用其他页面刚拉取的数据,跨页切换零重复 spawn
  useEffect(() => {
    useStudentStore.getState().fetchStudents()
    useClassStore.getState().fetchClasses()
  }, [])

  // 学生加载异常提示(与原行为一致: 仅 IPC 异常 toast,success:false 静默保留旧数据)
  const lastErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (studentsError && studentsError !== lastErrorRef.current) {
      toast.error(t('error.unknown'))
    }
    lastErrorRef.current = studentsError
  }, [studentsError, t])

  // 加载导出格式（从 EAA 获取支持列表，失败时使用 fallback）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const formats = await getAPI().eaa.exportFormats()
        if (!cancelled && Array.isArray(formats) && formats.length > 0) {
          setExportFormats(formats)
        }
      } catch (err) {
        console.warn('[Students] Failed to load export formats, using fallback:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 从 Dashboard 排行榜跳转过来时,学生列表加载完成后按 entity_id 自动选中并打开详情
  useEffect(() => {
    const targetId = searchParams.get('entity_id')
    if (!targetId || loading) return
    // LOW 修复: students 列表为空时(加载完成但无数据),也清除 URL param 并提示,
    // 避免之前直接 return 导致 entity_id param 残留在 URL 中。
    if (students.length === 0) {
      setSearchParams({}, { replace: true })
      toast.warning(t('page.students.locate.empty').replace('{id}', targetId))
      return
    }
    const match = students.find((s) => s.entity_id === targetId)
    if (match) {
      setSelectedStudent(match)
      // 清除 query param,避免刷新或返回时重复选中
      setSearchParams({}, { replace: true })
    } else {
      // entity_id 不存在: 清除 URL param 避免残留,并提示用户
      setSearchParams({}, { replace: true })
      toast.warning(t('page.students.locate.notFound').replace('{id}', targetId))
    }
  }, [students, loading, searchParams, setSearchParams, setSelectedStudent, t])

  // 已存档的班级 class_id 集合（用于默认隐藏这些班级的学生）
  const archivedClassIds = useMemo(
    () => new Set(classList.filter((c) => c.archived).map((c) => c.class_id)),
    [classList],
  )

  // class_id → 班级名称 映射（用于表格显示）
  const classIdToName = useMemo(() => buildClassIdToNameMap(classList), [classList])

  // 活跃班级列表（用于筛选下拉 + 批量调班目标下拉）
  const activeClassList = useMemo(() => classList.filter((c) => !c.archived), [classList])

  return {
    students,
    loading,
    classList,
    exportFormats,
    loadStudents,
    loadClasses,
    refreshStudents,
    archivedClassIds,
    classIdToName,
    activeClassList,
  }
}
