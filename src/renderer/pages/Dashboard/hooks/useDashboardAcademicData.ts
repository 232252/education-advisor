// =============================================================
// useDashboardAcademicData — 成绩优先视图的考试/配置/班级成绩
// 仅在 lens=grades 时启用，避免拖慢默认操行仪表盘。
// 考试默认最近一场；科目筛选可持久化（科任老师常用单科）。
// =============================================================

import { DEFAULT_SUBJECTS } from '@shared/academic-defaults'
import type { AcademicConfig, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalStorage } from '../../../hooks/useLocalStorage'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { sortByDateDesc } from '../../../lib/academics'
import { getAPI } from '../../../lib/ipc-client'
import { pickLatestExamId } from '../dashboard-academic-stats'
import { DASHBOARD_SUBJECT_KEY, EXAM_FILTER_ALL, SUBJECT_FILTER_ALL } from '../dashboard-lens'

const CATALOG_FALLBACKS = {
  exams: [] as ExamDef[],
  config: null as AcademicConfig | null,
}

const GRADES_FALLBACKS = {
  classGrades: {} as Record<string, GradeRecord[]>,
}

async function unwrapExams(): Promise<ExamDef[]> {
  const res = await getAPI().academic.listExams()
  return res.success && res.data ? res.data : []
}

async function unwrapConfig(): Promise<AcademicConfig | null> {
  const res = await getAPI().academic.getConfig()
  return res.success && res.data ? res.data : null
}

export function useDashboardAcademicData({
  enabled,
  studentNames,
}: {
  enabled: boolean
  studentNames: string[]
}) {
  const [examId, setExamId] = useState('')
  const [storedSubject, setStoredSubject] = useLocalStorage<string>(
    DASHBOARD_SUBJECT_KEY,
    SUBJECT_FILTER_ALL,
  )

  const catalog = useMultiLoader(
    {
      exams: unwrapExams,
      config: unwrapConfig,
    },
    { enabled, fallbacks: CATALOG_FALLBACKS },
  )

  const exams = catalog.data.exams
  const sortedExams = useMemo(() => sortByDateDesc(exams), [exams])
  const subjects = useMemo<SubjectDef[]>(
    () => (catalog.data.config?.subjects?.length ? catalog.data.config.subjects : DEFAULT_SUBJECTS),
    [catalog.data.config],
  )

  const subjectId =
    storedSubject === SUBJECT_FILTER_ALL || subjects.some((s) => s.id === storedSubject)
      ? storedSubject
      : SUBJECT_FILTER_ALL

  useEffect(() => {
    if (!enabled) return
    if (sortedExams.length === 0) {
      if (examId) setExamId('')
      return
    }
    // 「全部考试」哨兵值有效;其余非法 id(含空串)回退到最近一场
    if (examId !== EXAM_FILTER_ALL && (!examId || !sortedExams.some((e) => e.id === examId))) {
      setExamId(pickLatestExamId(sortedExams))
    }
  }, [enabled, sortedExams, examId])

  const namesKey = studentNames.join('\0')
  const gradesEnabled = enabled && examId.length > 0 && studentNames.length > 0
  const gradesLoader = useMultiLoader(
    {
      classGrades: async (): Promise<Record<string, GradeRecord[]>> => {
        // 全部考试 → 空 examId(后端不过滤考试)
        const res = await getAPI().academic.getClassGrades(
          studentNames,
          examId === EXAM_FILTER_ALL ? '' : examId,
        )
        return res.success && res.data ? res.data : {}
      },
    },
    { enabled: gradesEnabled, deps: [examId, namesKey], fallbacks: GRADES_FALLBACKS },
  )

  const catalogReady = catalog.readyKeys.has('exams') && catalog.readyKeys.has('config')
  const gradesReady =
    !gradesEnabled ||
    gradesLoader.readyKeys.has('classGrades') ||
    Boolean(gradesLoader.errors.classGrades)

  const catalogReload = catalog.reload
  const gradesReload = gradesLoader.reload
  const reload = useCallback(() => {
    catalogReload()
    gradesReload()
  }, [catalogReload, gradesReload])

  return {
    exams: sortedExams,
    subjects,
    examId,
    setExamId,
    subjectId,
    setSubjectId: setStoredSubject,
    classGrades: gradesLoader.data.classGrades,
    catalogReady,
    gradesReady,
    catalogLoading: catalog.loading,
    gradesLoading: gradesLoader.loading,
    errors: { ...catalog.errors, ...gradesLoader.errors },
    reload,
  }
}
