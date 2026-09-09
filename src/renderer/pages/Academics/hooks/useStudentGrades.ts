// =============================================================
// useStudentGrades — 按选中学生加载成绩记录
//
// grades 加载单独维护: 依赖 selectedStudent, 按需触发,
// 不并入 useAcademicsData 的初始并行加载 (见该文件注释)。
// 加载机制收口至 useIpcQuery: deps=[selectedStudent] 驱动重载,
// 信封失败/IPC 异常统一抛 Error(message), error.message 即 UI 文案。
// =============================================================

import type { GradeRecord } from '@shared/types'
import { useCallback } from 'react'
import { useIpcQuery } from '../../../hooks/useIpcQuery'
import { useT } from '../../../i18n'
import { errText, getAPI } from '../../../lib/ipc-client'

// 稳定空数组引用,避免加载前每次渲染产生新引用
const EMPTY_GRADES: GradeRecord[] = []

interface UseStudentGradesResult {
  grades: GradeRecord[]
  gradesLoading: boolean
  /** 成绩加载失败的错误信息 (null = 无错误);失败时 grades 为空,UI 需区分"无数据"与"加载失败" */
  gradesError: string | null
  /** 重新加载当前学生的成绩 */
  reloadGrades: () => void
}

export function useStudentGrades(selectedStudent: string | null): UseStudentGradesResult {
  const { t } = useT()
  const {
    data,
    error,
    loading: queryLoading,
    reload,
  } = useIpcQuery<GradeRecord[]>(
    async () => {
      if (!selectedStudent) return []
      try {
        const res = await getAPI().academic.getGrades(selectedStudent)
        if (res.success && res.data) return res.data
        throw new Error(res.error || t('page.academics.overview.loadFailed', '成绩数据加载失败'))
      } catch (err) {
        // errText(Error) 取 message — 信封错误文案经此保持原样
        throw new Error(errText(err))
      }
    },
    {
      deps: [selectedStudent],
      initialLoading: false,
      // 失败即清空(与原实现一致),UI 靠 gradesError 区分失败态
      keepDataOnError: false,
      scope: 'Academics',
    },
  )

  const grades = data ?? EMPTY_GRADES
  const gradesError = error === null ? null : errText(error)
  // 无学生时的空加载不视为 loading 态(与原实现: 仅真实拉取才置 loading)
  const gradesLoading = queryLoading && selectedStudent !== null

  const reloadGrades = useCallback(() => {
    if (selectedStudent) void reload()
  }, [selectedStudent, reload])

  return { grades, gradesLoading, gradesError, reloadGrades }
}
