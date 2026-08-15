// =============================================================
// useStudentGrades — 按选中学生加载成绩记录
//
// grades 加载单独维护: 依赖 selectedStudent, 按需触发,
// 不并入 useAcademicsData 的初始并行加载 (见该文件注释)。
// =============================================================

import type { GradeRecord } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { getAPI } from '../../../lib/ipc-client'

export interface UseStudentGradesResult {
  grades: GradeRecord[]
  gradesLoading: boolean
  /** 重新加载当前学生的成绩 */
  reloadGrades: () => void
}

export function useStudentGrades(selectedStudent: string | null): UseStudentGradesResult {
  const [grades, setGrades] = useState<GradeRecord[]>([])
  const [gradesLoading, setGradesLoading] = useState(false)

  const loadGrades = useCallback(async (studentName: string) => {
    if (!studentName) {
      setGrades([])
      return
    }
    setGradesLoading(true)
    try {
      const res = await getAPI().academic.getGrades(studentName)
      if (res.success && res.data) {
        setGrades(res.data)
      } else {
        setGrades([])
      }
    } catch (err) {
      console.warn('[Academics] Failed to load grades:', err)
      setGrades([])
    } finally {
      setGradesLoading(false)
    }
  }, [])

  // 学生切换时重新加载成绩
  useEffect(() => {
    if (selectedStudent) loadGrades(selectedStudent)
    else setGrades([])
  }, [selectedStudent, loadGrades])

  const reloadGrades = useCallback(() => {
    if (selectedStudent) loadGrades(selectedStudent)
  }, [selectedStudent, loadGrades])

  return { grades, gradesLoading, reloadGrades }
}
