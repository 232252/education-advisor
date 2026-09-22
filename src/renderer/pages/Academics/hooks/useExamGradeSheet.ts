// =============================================================
// useExamGradeSheet — 班级成绩单打印数据 hook
// 点击某场考试的"打印成绩单"时,批量拉取该考试全班成绩
// 并构建行数据(总分/排名)与科目统计。
// =============================================================

import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCallback, useState } from 'react'
import {
  buildGradeSheetRows,
  computeSubjectStats,
  type GradeSheetRow,
  type SubjectStat,
} from '../../../components/print/grade-sheet'
import { useT } from '../../../i18n'
import { mergeExamSubjects } from '../../../lib/academics'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

interface ExamGradeSheetData {
  exam: ExamDef
  /** 目录 ∪ 本场考试科目(目录外科目补齐后),供成绩单建列 */
  subjects: SubjectDef[]
  rows: GradeSheetRow[]
  subjectStats: SubjectStat[]
}

export function useExamGradeSheet(
  students: Pick<EAAStudent, 'name' | 'class_id'>[],
  /** 科目目录(config 或默认);考试科目不在目录时自动补齐 */
  catalogSubjects: SubjectDef[] = [],
) {
  const { t } = useT()
  const [sheet, setSheet] = useState<ExamGradeSheetData | null>(null)
  const [loading, setLoading] = useState(false)

  const printSheet = useCallback(
    async (exam: ExamDef) => {
      setLoading(true)
      try {
        const names = students.map((s) => s.name)
        let gradesByStudent: Record<string, GradeRecord[]> = {}
        if (names.length > 0) {
          const res = await getAPI().academic.getClassGrades(names, exam.id)
          if (res.success && res.data) gradesByStudent = res.data
        }
        const rows = buildGradeSheetRows(students, gradesByStudent, exam.subjects)
        const subjectStats = computeSubjectStats(rows, exam.subjects)
        // AI 导入的考试常带目录外科目(如「通用技术」),不补齐则预览表科目列整列消失
        const sheetSubjects = mergeExamSubjects(
          catalogSubjects,
          [exam],
          Object.values(gradesByStudent).flat(),
        )
        setSheet({ exam, subjects: sheetSubjects, rows, subjectStats })
      } catch (err) {
        console.error('[Print] load grade sheet failed:', err)
        toast.error(t('print.loadFailed', '打印数据加载失败'))
      } finally {
        setLoading(false)
      }
    },
    [students, catalogSubjects, t],
  )

  const closeSheet = useCallback(() => setSheet(null), [])

  return { sheet, loading, printSheet, closeSheet }
}
