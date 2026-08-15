// =============================================================
// useStudentSelection — 学生批量选择域 hook
// 封装 selectMode/selectedNames/batchDeleting/batchAssigning/batchAssignTarget
// 状态与 toggleSelect/toggleSelectAll/exitSelectMode 操作。
//
// PERF 设计（从 StudentsPage 原样保留）:
//   - toggleSelectAll 通过 filteredRef 读取最新可见列表,
//     保持 useCallback([]) 稳定引用,避免击穿 StudentRow memo
// =============================================================

import type { EAAStudent } from '@shared/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { isAllSelected } from '../lib/student-filters'

export function useStudentSelection(visibleStudents: EAAStudent[]) {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchAssigning, setBatchAssigning] = useState(false)
  // 批量调班目标班级
  const [batchAssignTarget, setBatchAssignTarget] = useState<string>('')

  // PERF: filtered 的最新引用 — 让 toggleSelectAll 可以 useCallback([]) 稳定引用
  const filteredRef = useRef<EAAStudent[]>([])
  // PERF: 同步 filtered 到 ref,供 toggleSelectAll 读取最新值而不破坏 useCallback 稳定性
  filteredRef.current = visibleStudents

  // 切换单个学生选中状态 — PERF: useCallback 稳定引用,避免击穿 StudentRow memo
  const toggleSelect = useCallback((name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  // 全选/取消全选（作用于当前可见列表）
  // PERF: 通过 filteredRef 读取最新 filtered,稳定 useCallback 引用
  const toggleSelectAll = useCallback(() => {
    setSelectedNames((prev) => {
      // 若当前可见项已全选，则清空；否则全选
      const visibleNames = filteredRef.current.map((s) => s.name)
      const allSelected = visibleNames.length > 0 && visibleNames.every((n) => prev.has(n))
      if (allSelected) {
        const next = new Set(prev)
        for (const n of visibleNames) next.delete(n)
        return next
      }
      const next = new Set(prev)
      for (const n of visibleNames) {
        next.add(n)
      }
      return next
    })
  }, [])

  // 退出选择模式
  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedNames(new Set())
    setBatchAssignTarget('')
  }, [])

  // 当前可见列表是否全选
  const allVisibleSelected = useMemo(
    () => isAllSelected(visibleStudents, selectedNames),
    [visibleStudents, selectedNames],
  )

  return {
    selectMode,
    setSelectMode,
    selectedNames,
    batchDeleting,
    setBatchDeleting,
    batchAssigning,
    setBatchAssigning,
    batchAssignTarget,
    setBatchAssignTarget,
    toggleSelect,
    toggleSelectAll,
    exitSelectMode,
    allVisibleSelected,
  }
}
