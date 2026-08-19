// =============================================================
// useExamGradeSheet — 班级成绩单打印数据 hook
// 点击某场考试的"打印成绩单"时,批量拉取该考试全班成绩
// 并构建行数据(总分/排名)与科目统计。
// =============================================================

import type { EAAStudent, ExamDef } from '@shared/types'
import { useCallback, useState } from 'react'
import {
  buildGradeSheetRows,
  computeSubjectStats,
  type GradeSheetRow,
  type SubjectStat,
} from '../../../components/print/grade-sheet'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export interface ExamGradeSheetData {
  exam: ExamDef
  rows: GradeSheetRow[]
  subjectStats: SubjectStat[]
}

export function useExamGradeSheet(students: Pick<EAAStudent, 'name' | 'class_id'>[]) {
  const { t } = useT()
  const [sheet, setSheet] = useState<ExamGradeSheetData | null>(null)
  const [loading, setLoading] = useState(false)

  const printSheet = useCallback(
    async (exam: ExamDef) => {
      setLoading(true)
      try {
        const names = students.map((s) => s.name)
        let gradesByStudent: Record<string, import('@shared/types').GradeRecord[]> = {}
        if (names.length > 0) {
          const res = await getAPI().academic.getClassGrades(names, exam.id)
          if (res.success && res.data) gradesByStudent = res.data
        }
        const rows = buildGradeSheetRows(students, gradesByStudent, exam.subjects)
        const subjectStats = computeSubjectStats(rows, exam.subjects)
        setSheet({ exam, rows, subjectStats })
      } catch (err) {
        console.error('[Print] load grade sheet failed:', err)
        toast.error(t('print.loadFailed', '打印数据加载失败'))
      } finally {
        setLoading(false)
      }
    },
    [students, t],
  )

  const closeSheet = useCallback(() => setSheet(null), [])

  return { sheet, loading, printSheet, closeSheet }
}
