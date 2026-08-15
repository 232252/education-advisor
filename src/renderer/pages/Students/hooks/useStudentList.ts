// =============================================================
// useStudentList — 学生列表数据加载域 hook
// 封装 students/classList/loading/exportFormats 状态与
// loadStudents/loadClasses/refreshStudents 加载函数,
// 以及 archivedClassIds/classIdToName/activeClassList 派生数据
// 和 Dashboard 排行榜跳转的 entity_id 自动选中逻辑。
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useT } from '../../../i18n'
import { buildClassIdToNameMap } from '../../../lib/class-utils'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useStudentList(setSelectedStudent: (s: EAAStudent | null) => void) {
  const { t } = useT()
  const [students, setStudents] = useState<EAAStudent[]>([])
  const [loading, setLoading] = useState(true)
  // 班级（用于按已存档班级隐藏学生 + 班级筛选）
  const [classList, setClassList] = useState<ClassEntity[]>([])
  // 导出格式：从 EAA 动态获取（fallback 到内置列表）
  // C-2 修复: fallback 列表必须与 EAA Rust 端 cmd_export 一致 (csv/jsonl/html)
  // 之前包含 json 和 markdown,EAA 不支持,选了会报"未知导出格式"错误
  const [exportFormats, setExportFormats] = useState<string[]>(['csv', 'jsonl', 'html'])
  // 从 Dashboard 排行榜跳转时,通过 query param 携带 entity_id 自动选中学生
  const [searchParams, setSearchParams] = useSearchParams()

  // 加载学生列表 (过滤掉已删除学生 status=Deleted,避免软删除学生干扰列表)
  const loadStudents = useCallback(async () => {
    try {
      const result = await getAPI().eaa.listStudents()
      if (result.success && result.data?.students) {
        setStudents(result.data.students.filter((s) => s.status !== 'Deleted'))
      }
    } catch (err) {
      console.error('[Students] Failed to load:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // 加载班级列表（用于按已存档班级过滤学生）
  const loadClasses = useCallback(async () => {
    try {
      const res = await getAPI().class.list()
      if (res.success && res.data) setClassList(res.data)
    } catch (err) {
      console.warn('[Students] Failed to load classes:', err)
    }
  }, [])

  // 手动刷新：先清空 EAA 读缓存，再重新加载（强制重新拉取最新数据）
  const refreshStudents = useCallback(async () => {
    try {
      await getAPI().eaa.invalidateCache()
    } catch {
      /* 清缓存失败不阻塞 */
    }
    await loadStudents()
  }, [loadStudents])

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

  useEffect(() => {
    loadStudents()
    loadClasses()
  }, [loadStudents, loadClasses])

  // 从 Dashboard 排行榜跳转过来时,学生列表加载完成后按 entity_id 自动选中并打开详情
  useEffect(() => {
    const targetId = searchParams.get('entity_id')
    if (!targetId || loading) return
    // LOW 修复: students 列表为空时(加载完成但无数据),也清除 URL param 并提示,
    // 避免之前直接 return 导致 entity_id param 残留在 URL 中。
    if (students.length === 0) {
      setSearchParams({}, { replace: true })
      toast.warning(`学生列表为空,无法定位 (entity_id: ${targetId})`)
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
      toast.warning(`未找到该学生 (entity_id: ${targetId})`)
    }
  }, [students, loading, searchParams, setSearchParams, setSelectedStudent])

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
