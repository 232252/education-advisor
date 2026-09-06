// =============================================================
// useCompareData — 成绩对比 Tab 的状态与数据加载
//
// 管理: 班级/两场考试选择, 全班成绩与操行分事件拉取,
//       对比结果 (studentComparisons / summary) 计算。
// 纯计算在 ../lib/academics-metrics.ts,
// 对比核心算法在 ../exam-comparison.ts。
// =============================================================

import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConductEvents, useExamPairSelection } from '../../../hooks/useExamPair'
import { useT } from '../../../i18n'
import {
  computeStudentComparisons,
  filterStudentNamesByClass,
  sortByDateAsc,
  summarizeClassComparison,
} from '../../../lib/academics'
import { CLASS_FILTER_ALL } from '../../../lib/class-filter'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

interface UseCompareDataParams {
  students: EAAStudent[]
  subjects: SubjectDef[]
  exams: ExamDef[]
}

export function useCompareData({ students, subjects, exams }: UseCompareDataParams) {
  const { t } = useT()
  const [classFilter, setClassFilter] = useState<string>(CLASS_FILTER_ALL)
  const [loading, setLoading] = useState(false)
  const [classGradesA, setClassGradesA] = useState<Record<string, GradeRecord[]> | null>(null)
  const [classGradesB, setClassGradesB] = useState<Record<string, GradeRecord[]> | null>(null)

  // subjectId → 中文名(纯函数模块要求 Record<string,string>)
  const subjectNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of subjects) m[s.id] = s.name
    return m
  }, [subjects])

  // 当前班级的学生名(按 classFilter 过滤,status 非 Deleted)
  const targetStudentNames = useMemo(
    () => filterStudentNamesByClass(students, classFilter),
    [students, classFilter],
  )

  // 按日期升序的考试列表
  const sortedExams = useMemo(() => sortByDateAsc(exams), [exams])

  // 考试 A/B 选择(默认最近两场)+ 操行分 range 拉取,实现见 hooks/useExamPair
  const { examAId, setExamAId, examBId, setExamBId } = useExamPairSelection(sortedExams)
  const conductEvents = useConductEvents(exams, examAId, examBId, 5000)

  // 加载对比数据
  // 代际防护: 切换考试对后,晚到的旧响应不得覆盖新数据;旧请求的 finally 也不得提前关闭新请求的 loading
  const loadGenRef = useRef(0)
  const loadComparison = useCallback(async () => {
    const gen = ++loadGenRef.current
    if (!examAId || !examBId || examAId === examBId || targetStudentNames.length === 0) {
      setClassGradesA(null)
      setClassGradesB(null)
      return
    }
    setLoading(true)
    try {
      const [resA, resB] = await Promise.allSettled([
        getAPI().academic.getClassGrades(targetStudentNames, examAId),
        getAPI().academic.getClassGrades(targetStudentNames, examBId),
      ])
      if (loadGenRef.current !== gen) return
      if (resA.status === 'fulfilled' && resA.value.success && resA.value.data) {
        setClassGradesA(resA.value.data)
      }
      if (resB.status === 'fulfilled' && resB.value.success && resB.value.data) {
        setClassGradesB(resB.value.data)
      }
      // 操行分事件由 useConductEvents 独立拉取(与成绩加载并行)
    } catch (err) {
      if (loadGenRef.current !== gen) return
      console.warn('[CompareTab] load failed:', err)
      toast.error(
        getErrorMessage({ success: false } as never, t('page.academics.toast.compareLoadFailed')),
      )
    } finally {
      if (loadGenRef.current === gen) setLoading(false)
    }
  }, [examAId, examBId, targetStudentNames, t])

  useEffect(() => {
    loadComparison()
  }, [loadComparison])

  // 计算对比结果(纯函数)
  const { studentComparisons, summary } = useMemo(() => {
    if (!classGradesA || !classGradesB) return { studentComparisons: [], summary: null }
    const comps = computeStudentComparisons(
      classGradesA,
      classGradesB,
      conductEvents,
      targetStudentNames,
      subjectNameMap,
    )
    return { studentComparisons: comps, summary: summarizeClassComparison(comps) }
  }, [classGradesA, classGradesB, conductEvents, targetStudentNames, subjectNameMap])

  const canCompare = examAId && examBId && examAId !== examBId && targetStudentNames.length > 0

  return {
    classFilter,
    setClassFilter,
    examAId,
    setExamAId,
    examBId,
    setExamBId,
    sortedExams,
    targetStudentNames,
    loading,
    studentComparisons,
    summary,
    canCompare,
  }
}
