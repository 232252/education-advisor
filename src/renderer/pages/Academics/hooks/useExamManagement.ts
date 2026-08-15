// =============================================================
// useExamManagement — 考试管理 Tab 的状态与动作
//
// 管理: 创建表单受控状态 (名称/类型/日期/学期/范围/科目)、
//       创建/删除考试动作、删除确认对话框状态。
// UI 在 ../components/exam-mgmt/。
// =============================================================

import type { ExamDef, ExamType, SubjectDef } from '@shared/types'
import { useCallback, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { getCurrentSemester } from '../academics-shared'

export interface UseExamManagementParams {
  subjects: SubjectDef[]
  onRefresh: () => void
}

export function useExamManagement({ subjects, onRefresh }: UseExamManagementParams) {
  const { t } = useT()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; exam: ExamDef | null }>({
    open: false,
    exam: null,
  })

  // 创建表单状态
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<ExamType>('monthly')
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10))
  const [formSemester, setFormSemester] = useState(getCurrentSemester())
  const [formScope, setFormScope] = useState('')
  const [formSubjects, setFormSubjects] = useState<Set<string>>(new Set())

  const handleToggleSubject = useCallback((subjectId: string) => {
    setFormSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(subjectId)) next.delete(subjectId)
      else next.add(subjectId)
      return next
    })
  }, [])

  const handleSelectAllSubjects = useCallback(() => {
    setFormSubjects(new Set(subjects.map((s) => s.id)))
  }, [subjects])

  const handleClearSubjects = useCallback(() => {
    setFormSubjects(new Set())
  }, [])

  const resetForm = useCallback(() => {
    setFormName('')
    setFormType('monthly')
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormSemester(getCurrentSemester())
    setFormScope('')
    setFormSubjects(new Set())
  }, [])

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      toast.error(t('page.academics.toast.examNameRequired'))
      return
    }
    if (formSubjects.size === 0) {
      toast.error(t('page.academics.toast.atLeastOneSubject'))
      return
    }
    setCreating(true)
    try {
      const res = await getAPI().academic.createExam({
        name: formName.trim(),
        type: formType,
        date: formDate,
        semester: formSemester.trim() || getCurrentSemester(),
        scope: formScope.trim() || undefined,
        subjects: Array.from(formSubjects),
      })
      if (res.success) {
        toast.success(t('page.academics.toast.examCreated'))
        resetForm()
        setShowCreateForm(false)
        onRefresh()
      } else {
        toast.error(getErrorMessage(res, t('page.academics.toast.createFailed')))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.createFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setCreating(false)
    }
  }, [formName, formType, formDate, formSemester, formScope, formSubjects, resetForm, onRefresh, t])

  const handleDelete = useCallback((exam: ExamDef) => {
    setDeleteConfirm({ open: true, exam })
  }, [])

  const executeDelete = useCallback(async () => {
    const exam = deleteConfirm.exam
    setDeleteConfirm({ open: false, exam: null })
    if (!exam) return
    try {
      const res = await getAPI().academic.deleteExam(exam.id)
      if (res.success) {
        toast.success(t('page.academics.toast.examDeleted'))
        onRefresh()
      } else {
        toast.error(res.error ?? t('toast.common.deleteFailed'))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.deleteFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    }
  }, [deleteConfirm.exam, onRefresh, t])

  return {
    showCreateForm,
    setShowCreateForm,
    creating,
    deleteConfirm,
    setDeleteConfirm,
    formName,
    setFormName,
    formType,
    setFormType,
    formDate,
    setFormDate,
    formSemester,
    setFormSemester,
    formScope,
    setFormScope,
    formSubjects,
    handleToggleSubject,
    handleSelectAllSubjects,
    handleClearSubjects,
    resetForm,
    handleCreate,
    handleDelete,
    executeDelete,
  }
}
