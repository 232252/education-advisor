// =============================================================
// 考试管理 Tab — 编排: 考试列表展示 + 创建表单 + 删除确认
// 状态与动作在 ../hooks/useExamManagement.ts,
// UI 块在 ../components/exam-mgmt/
// =============================================================

import type { ExamDef, ExamType, SubjectDef } from '@shared/types'
import { useMemo } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { sortByDateDesc } from '../academics-shared'
import { CreateExamFormCard, ExamCardGrid, ExamListHeader } from '../components/exam-mgmt'
import { useExamManagement } from '../hooks/useExamManagement'

export interface ExamManagementTabProps {
  subjects: SubjectDef[]
  examTypes: Array<{ value: ExamType; label: string }>
  exams: ExamDef[]
  onRefresh: () => void
}

export function ExamManagementTab({
  subjects,
  examTypes,
  exams,
  onRefresh,
}: ExamManagementTabProps) {
  const sortedExams = useMemo(() => sortByDateDesc(exams), [exams])

  const {
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
  } = useExamManagement({ subjects, onRefresh })

  return (
    <div className="space-y-4">
      <ExamListHeader
        examCount={exams.length}
        showCreateForm={showCreateForm}
        onToggleCreateForm={() => setShowCreateForm(!showCreateForm)}
      />

      {/* 创建表单 */}
      {showCreateForm && (
        <CreateExamFormCard
          subjects={subjects}
          examTypes={examTypes}
          formName={formName}
          onFormNameChange={setFormName}
          formType={formType}
          onFormTypeChange={setFormType}
          formDate={formDate}
          onFormDateChange={setFormDate}
          formSemester={formSemester}
          onFormSemesterChange={setFormSemester}
          formScope={formScope}
          onFormScopeChange={setFormScope}
          formSubjects={formSubjects}
          onToggleSubject={handleToggleSubject}
          onSelectAllSubjects={handleSelectAllSubjects}
          onClearSubjects={handleClearSubjects}
          creating={creating}
          onCreate={handleCreate}
          onCancel={() => {
            resetForm()
            setShowCreateForm(false)
          }}
        />
      )}

      {/* 考试列表 */}
      <ExamCardGrid exams={sortedExams} subjects={subjects} onDelete={handleDelete} />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirm.open}
        title="删除考试"
        message={`确定要删除考试"${deleteConfirm.exam?.name}"吗？相关成绩记录也将被删除,此操作不可恢复。`}
        confirmText="删除"
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setDeleteConfirm({ open: false, exam: null })}
      />
    </div>
  )
}
