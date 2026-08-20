// =============================================================
// useStudentGrades — 按选中学生加载成绩记录
//
// grades 加载单独维护: 依赖 selectedStudent, 按需触发,
// 不并入 useAcademicsData 的初始并行加载 (见该文件注释)。
// =============================================================

import type { GradeRecord } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'

export interface UseStudentGradesResult {
  grades: GradeRecord[]
  gradesLoading: boolean
  /** 成绩加载失败的错误信息 (null = 无错误);失败时 grades 为空,UI 需区分"无数据"与"加载失败" */
  gradesError: string | null
  /** 重新加载当前学生的成绩 */
  reloadGrades: () => void
}

export function useStudentGrades(selectedStudent: string | null): UseStudentGradesResult {
  const { t } = useT()
  const [grades, setGrades] = useState<GradeRecord[]>([])
  const [gradesLoading, setGradesLoading] = useState(false)
  const [gradesError, setGradesError] = useState<string | null>(null)

  const loadGrades = useCallback(
    async (studentName: string) => {
      if (!studentName) {
        setGrades([])
        setGradesError(null)
        return
      }
      setGradesLoading(true)
      try {
        const res = await getAPI().academic.getGrades(studentName)
        if (res.success && res.data) {
          setGrades(res.data)
          setGradesError(null)
        } else {
          setGrades([])
          setGradesError(res.error || t('page.academics.overview.loadFailed', '成绩数据加载失败'))
        }
      } catch (err) {
        console.warn('[Academics] Failed to load grades:', err)
        setGrades([])
        setGradesError(err instanceof Error ? err.message : String(err))
      } finally {
        setGradesLoading(false)
      }
    },
    [t],
  )

  // 学生切换时重新加载成绩
  useEffect(() => {
    if (selectedStudent) loadGrades(selectedStudent)
    else {
      setGrades([])
      setGradesError(null)
    }
  }, [selectedStudent, loadGrades])

  const reloadGrades = useCallback(() => {
    if (selectedStudent) loadGrades(selectedStudent)
  }, [selectedStudent, loadGrades])

  return { grades, gradesLoading, gradesError, reloadGrades }
}
