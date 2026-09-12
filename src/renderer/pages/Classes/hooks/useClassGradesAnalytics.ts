// =============================================================
// useClassGradesAnalytics — class-scoped exam catalog, single-exam
// grades, lightweight two-exam comparison, and multi-exam class
// average trend. Reuses academic APIs only (listExams / getConfig /
// getClassGrades). No new IPC.
// =============================================================

import { DEFAULT_SUBJECTS } from '@shared/academic-defaults'
import type { AcademicConfig, EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useExamPairSelection } from '../../../hooks/useExamPair'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { computeStudentComparisons, sortByDateAsc, sortByDateDesc } from '../../../lib/academics'
import { getAPI } from '../../../lib/ipc-client'
import { pickLatestExamId } from '../../Dashboard/dashboard-academic-stats'
import { SUBJECT_FILTER_ALL } from '../../Dashboard/dashboard-lens'
import { buildClassAvgTrend, pickTrendExams } from '../lib/class-avg-trend'
import { summarizeScoreMovement } from '../lib/grade-movement'

const CATALOG_FALLBACKS = {
  exams: [] as ExamDef[],
  config: null as AcademicConfig | null,
}

const GRADES_FALLBACKS = {
  classGrades: {} as Record<string, GradeRecord[]>,
}

const COMPARE_FALLBACKS = {
  gradesA: {} as Record<string, GradeRecord[]>,
  gradesB: {} as Record<string, GradeRecord[]>,
}

const TREND_FALLBACKS = {
  gradesByExam: {} as Record<string, Record<string, GradeRecord[]>>,
}

async function unwrapExams(): Promise<ExamDef[]> {
  const res = await getAPI().academic.listExams()
  return res.success && res.data ? res.data : []
}

async function unwrapConfig(): Promise<AcademicConfig | null> {
  const res = await getAPI().academic.getConfig()
  return res.success && res.data ? res.data : null
}

export function useClassGradesAnalytics({
  enabled = true,
  students,
}: {
  enabled?: boolean
  students: EAAStudent[]
}) {
  const [examId, setExamId] = useState('')
  const [subjectId, setSubjectId] = useState(SUBJECT_FILTER_ALL)

  const studentNames = useMemo(() => students.map((s) => s.name), [students])
  const namesKey = studentNames.join('\0')

  const catalog = useMultiLoader(
    {
      exams: unwrapExams,
      config: unwrapConfig,
    },
    { enabled, fallbacks: CATALOG_FALLBACKS },
  )

  const exams = catalog.data.exams
  const sortedExams = useMemo(() => sortByDateDesc(exams), [exams])
  const sortedExamsAsc = useMemo(() => sortByDateAsc(exams), [exams])
  const subjects = useMemo<SubjectDef[]>(
    () => (catalog.data.config?.subjects?.length ? catalog.data.config.subjects : DEFAULT_SUBJECTS),
    [catalog.data.config],
  )

  const subjectNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of subjects) m[s.id] = s.name
    return m
  }, [subjects])

  useEffect(() => {
    if (!enabled) return
    if (sortedExams.length === 0) {
      if (examId) setExamId('')
      return
    }
    if (!examId || !sortedExams.some((e) => e.id === examId)) {
      setExamId(pickLatestExamId(sortedExams))
    }
  }, [enabled, sortedExams, examId])

  const gradesEnabled = enabled && examId.length > 0 && studentNames.length > 0
  const gradesLoader = useMultiLoader(
    {
      classGrades: async (): Promise<Record<string, GradeRecord[]>> => {
        const res = await getAPI().academic.getClassGrades(studentNames, examId)
        return res.success && res.data ? res.data : {}
      },
    },
    { enabled: gradesEnabled, deps: [examId, namesKey], fallbacks: GRADES_FALLBACKS },
  )

  const { examAId, setExamAId, examBId, setExamBId } = useExamPairSelection(sortedExamsAsc)
  const compareEnabled =
    enabled &&
    examAId.length > 0 &&
    examBId.length > 0 &&
    examAId !== examBId &&
    studentNames.length > 0

  const compareLoader = useMultiLoader(
    {
      gradesA: async (): Promise<Record<string, GradeRecord[]>> => {
        const res = await getAPI().academic.getClassGrades(studentNames, examAId)
        return res.success && res.data ? res.data : {}
      },
      gradesB: async (): Promise<Record<string, GradeRecord[]>> => {
        const res = await getAPI().academic.getClassGrades(studentNames, examBId)
        return res.success && res.data ? res.data : {}
      },
    },
    {
      enabled: compareEnabled,
      deps: [examAId, examBId, namesKey],
      fallbacks: COMPARE_FALLBACKS,
    },
  )

  const trendExams = useMemo(() => (examId ? pickTrendExams(exams, examId) : []), [exams, examId])
  const trendExamIdsKey = trendExams.map((e) => e.id).join(',')
  const trendEnabled = enabled && trendExams.length >= 2 && studentNames.length > 0

  const trendLoader = useMultiLoader(
    {
      gradesByExam: async (): Promise<Record<string, Record<string, GradeRecord[]>>> => {
        const entries = await Promise.all(
          trendExams.map(async (exam) => {
            const res = await getAPI().academic.getClassGrades(studentNames, exam.id)
            return [exam.id, res.success && res.data ? res.data : {}] as const
          }),
        )
        return Object.fromEntries(entries)
      },
    },
    {
      enabled: trendEnabled,
      deps: [trendExamIdsKey, namesKey],
      fallbacks: TREND_FALLBACKS,
    },
  )

  const trendPoints = useMemo(
    () => buildClassAvgTrend(trendExams, trendLoader.data.gradesByExam, subjectId),
    [trendExams, trendLoader.data.gradesByExam, subjectId],
  )

  const studentComparisons = useMemo(() => {
    if (!compareEnabled) return []
    return computeStudentComparisons(
      compareLoader.data.gradesA,
      compareLoader.data.gradesB,
      null,
      studentNames,
      subjectNameMap,
    )
  }, [
    compareEnabled,
    compareLoader.data.gradesA,
    compareLoader.data.gradesB,
    studentNames,
    subjectNameMap,
  ])

  const movement = useMemo(() => summarizeScoreMovement(studentComparisons), [studentComparisons])

  const catalogReady = catalog.readyKeys.has('exams') && catalog.readyKeys.has('config')
  const gradesReady =
    !gradesEnabled ||
    gradesLoader.readyKeys.has('classGrades') ||
    Boolean(gradesLoader.errors.classGrades)
  const compareReady =
    !compareEnabled ||
    (compareLoader.readyKeys.has('gradesA') && compareLoader.readyKeys.has('gradesB')) ||
    Boolean(compareLoader.errors.gradesA || compareLoader.errors.gradesB)
  const trendReady =
    !trendEnabled ||
    trendLoader.readyKeys.has('gradesByExam') ||
    Boolean(trendLoader.errors.gradesByExam)

  const selectedExam = useMemo(
    () => sortedExams.find((e) => e.id === examId) ?? null,
    [sortedExams, examId],
  )

  const catalogReload = catalog.reload
  const gradesReload = gradesLoader.reload
  const compareReload = compareLoader.reload
  const trendReload = trendLoader.reload
  const reload = useCallback(() => {
    catalogReload()
    gradesReload()
    compareReload()
    trendReload()
  }, [catalogReload, gradesReload, compareReload, trendReload])

  return {
    exams: sortedExams,
    subjects,
    examId,
    setExamId,
    subjectId,
    setSubjectId,
    selectedExam,
    classGrades: gradesLoader.data.classGrades,
    examAId,
    setExamAId,
    examBId,
    setExamBId,
    studentComparisons,
    movement,
    canCompare: compareEnabled,
    trendPoints,
    trendReady,
    catalogReady,
    gradesReady,
    compareReady,
    catalogLoading: catalog.loading,
    gradesLoading: gradesLoader.loading,
    compareLoading: compareLoader.loading,
    errors: {
      ...catalog.errors,
      ...gradesLoader.errors,
      ...compareLoader.errors,
      ...trendLoader.errors,
    },
    reload,
  }
}
