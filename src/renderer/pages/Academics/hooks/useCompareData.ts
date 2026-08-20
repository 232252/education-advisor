// =============================================================
// useCompareData — 成绩对比 Tab 的状态与数据加载
//
// 管理: 班级/两场考试选择, 全班成绩与操行分事件拉取,
//       对比结果 (studentComparisons / summary) 计算。
// 纯计算在 ../lib/academics-metrics.ts,
// 对比核心算法在 ../exam-comparison.ts。
// =============================================================

import type { EAAEventRecord, EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from '../../../i18n'
import {
  computeStudentComparisons,
  filterStudentNamesByClass,
  sortByDateAsc,
  summarizeClassComparison,
} from '../../../lib/academics'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export interface UseCompareDataParams {
  students: EAAStudent[]
  subjects: SubjectDef[]
  exams: ExamDef[]
}

export function useCompareData({ students, subjects, exams }: UseCompareDataParams) {
  const { t } = useT()
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  const [examAId, setExamAId] = useState<string>('')
  const [examBId, setExamBId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [classGradesA, setClassGradesA] = useState<Record<string, GradeRecord[]> | null>(null)
  const [classGradesB, setClassGradesB] = useState<Record<string, GradeRecord[]> | null>(null)
  const [conductEvents, setConductEvents] = useState<EAAEventRecord[] | null>(null)

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

  // 默认选最近两场
  useEffect(() => {
    if (sortedExams.length >= 2 && !examAId && !examBId) {
      setExamAId(sortedExams[sortedExams.length - 2].id)
      setExamBId(sortedExams[sortedExams.length - 1].id)
    }
  }, [sortedExams, examAId, examBId])

  // 加载对比数据
  const loadComparison = useCallback(async () => {
    if (!examAId || !examBId || examAId === examBId || targetStudentNames.length === 0) {
      setClassGradesA(null)
      setClassGradesB(null)
      setConductEvents(null)
      return
    }
    setLoading(true)
    try {
      const examA = exams.find((e) => e.id === examAId)
      const examB = exams.find((e) => e.id === examBId)
      const [resA, resB] = await Promise.allSettled([
        getAPI().academic.getClassGrades(targetStudentNames, examAId),
        getAPI().academic.getClassGrades(targetStudentNames, examBId),
      ])
      if (resA.status === 'fulfilled' && resA.value.success && resA.value.data) {
        setClassGradesA(resA.value.data)
      }
      if (resB.status === 'fulfilled' && resB.value.success && resB.value.data) {
        setClassGradesB(resB.value.data)
      }
      // 加载两次考试日期之间的操行分事件
      if (examA?.date && examB?.date) {
        const start = examA.date <= examB.date ? examA.date : examB.date
        const end = examA.date <= examB.date ? examB.date : examA.date
        try {
          const rangeRes = await getAPI().eaa.range(start, end, 5000)
          if (rangeRes.success && rangeRes.data) {
            // M10: range 结果达上限(limit 被截断为 1000)时提醒缩小日期范围
            if (rangeRes.data.truncated) {
              toast.warning(t('toast.eaa.rangeTruncated'))
            }
            setConductEvents(rangeRes.data.events ?? [])
          } else {
            setConductEvents(null)
          }
        } catch {
          setConductEvents(null)
        }
      }
    } catch (err) {
      console.warn('[CompareTab] load failed:', err)
      toast.error(
        getErrorMessage({ success: false } as never, t('page.academics.toast.compareLoadFailed')),
      )
    } finally {
      setLoading(false)
    }
  }, [examAId, examBId, exams, targetStudentNames, t])

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
