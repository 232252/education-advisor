// =============================================================
// useExamManagement — 考试管理 Tab 的状态与动作
//
// 管理: 创建表单受控状态 (名称/类型/日期/学期/范围/科目)、
//       创建/删除考试动作、删除确认对话框状态。
// UI 在 ../components/exam-mgmt/。
// =============================================================

import type { ExamDef, ExamType, SubjectDef } from '@shared/types'
import { useCallback, useState } from 'react'
import { tr, useT } from '../../../i18n'
import { getCurrentSemester } from '../../../lib/academics'
import { errText, getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { runIpcMutation } from '../../../lib/mutation'
import { todayISO } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

interface UseExamManagementParams {
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
  const [formDate, setFormDate] = useState(todayISO())
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
    setFormDate(todayISO())
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
    const ok = await runIpcMutation(
      () =>
        getAPI().academic.createExam({
          name: formName.trim(),
          type: formType,
          date: formDate,
          semester: formSemester.trim() || getCurrentSemester(),
          scope: formScope.trim() || undefined,
          subjects: Array.from(formSubjects),
        }),
      {
        onOk: () => {
          toast.success(t('page.academics.toast.examCreated'))
          resetForm()
          setShowCreateForm(false)
          onRefresh()
        },
        failMsg: (r) => getErrorMessage(r, t('page.academics.toast.createFailed')),
        catchMsg: (err) =>
          tr('page.academics.toast.createFailedWithError', { error: errText(err) }),
      },
    )
    setCreating(false)
    return ok
  }, [formName, formType, formDate, formSemester, formScope, formSubjects, resetForm, onRefresh, t])

  const handleDelete = useCallback((exam: ExamDef) => {
    setDeleteConfirm({ open: true, exam })
  }, [])

  const executeDelete = useCallback(async () => {
    const exam = deleteConfirm.exam
    setDeleteConfirm({ open: false, exam: null })
    if (!exam) return
    await runIpcMutation(() => getAPI().academic.deleteExam(exam.id), {
      onOk: () => {
        toast.success(t('page.academics.toast.examDeleted'))
        onRefresh()
      },
      failMsg: (r) => r.error ?? t('toast.common.deleteFailed'),
      catchMsg: (err) => tr('page.academics.toast.deleteFailedWithError', { error: errText(err) }),
    })
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
