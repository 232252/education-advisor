// =============================================================
// useStudentPrintData — 学生报告打印数据按需加载
// 点击打印时才拉取 grades/exams/config(成绩/考试/科目),
// 操行数据(score/history/profileData)由调用方从既有 hook 透传。
// =============================================================

import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCallback, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { DEFAULT_SUBJECTS } from '../../pages/Academics/lib/academics-defaults'
import { toast } from '../../stores/toastStore'

export interface StudentPrintData {
  grades: GradeRecord[]
  exams: ExamDef[]
  subjects: SubjectDef[]
}

export function useStudentPrintData(student: EAAStudent) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<StudentPrintData | null>(null)

  const openPrint = useCallback(async () => {
    setOpen(true)
    setLoading(true)
    try {
      const [gradeRes, examRes, configRes] = await Promise.allSettled([
        getAPI().academic.getGrades(student.name),
        getAPI().academic.listExams(),
        getAPI().academic.getConfig(),
      ])
      const grades =
        gradeRes.status === 'fulfilled' && gradeRes.value.success && gradeRes.value.data
          ? gradeRes.value.data
          : []
      const exams =
        examRes.status === 'fulfilled' && examRes.value.success && examRes.value.data
          ? examRes.value.data
          : []
      const config =
        configRes.status === 'fulfilled' && configRes.value.success ? configRes.value.data : null
      const subjects = config?.subjects?.length ? config.subjects : DEFAULT_SUBJECTS
      setData({ grades, exams, subjects })
    } catch (err) {
      console.error('[Print] load student report data failed:', err)
      toast.error(t('print.loadFailed', '打印数据加载失败'))
    } finally {
      setLoading(false)
    }
  }, [student.name, t])

  const closePrint = useCallback(() => {
    setOpen(false)
    setData(null)
  }, [])

  return { open, loading, data, openPrint, closePrint }
}
