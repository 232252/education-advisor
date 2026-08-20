// =============================================================
// 考试管理 Tab — 编排: 考试列表展示 + 创建表单 + 删除确认
// 状态与动作在 ../hooks/useExamManagement.ts,
// UI 块在 ../components/exam-mgmt/
// =============================================================

import type { EAAStudent, ExamDef, ExamType, SubjectDef } from '@shared/types'
import { useMemo } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ClassGradeSheetDocument } from '../../../components/print/ClassGradeSheetDocument'
import { PrintOverlay } from '../../../components/print/PrintOverlay'
import { useT } from '../../../i18n'
import { sortByDateDesc } from '../../../lib/academics'
import { CreateExamFormCard, ExamCardGrid, ExamListHeader } from '../components/exam-mgmt'
import { useExamGradeSheet } from '../hooks/useExamGradeSheet'
import { useExamManagement } from '../hooks/useExamManagement'

export interface ExamManagementTabProps {
  subjects: SubjectDef[]
  examTypes: Array<{ value: ExamType; label: string }>
  exams: ExamDef[]
  onRefresh: () => void
  /** 学生名单(打印班级成绩单用) */
  students: EAAStudent[]
  /** 班级 ID → 名称映射(成绩单表头班级显示名) */
  classIdToName?: Record<string, string>
}

export function ExamManagementTab({
  subjects,
  examTypes,
  exams,
  onRefresh,
  students,
  classIdToName,
}: ExamManagementTabProps) {
  const { t } = useT()

  const sortedExams = useMemo(() => sortByDateDesc(exams), [exams])
  const gradeSheet = useExamGradeSheet(students)

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
      <ExamCardGrid
        exams={sortedExams}
        subjects={subjects}
        onDelete={handleDelete}
        onPrintSheet={(exam) => void gradeSheet.printSheet(exam)}
        printLoading={gradeSheet.loading}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirm.open}
        title={t('page.academics.exams.deleteExamTitle', '删除考试')}
        message={`${t('page.academics.exams.deleteConfirmPrefix', '确定要删除考试"')}${deleteConfirm.exam?.name}${t(
          'page.academics.exams.deleteConfirmSuffix',
          '"吗？相关成绩记录也将被删除,此操作不可恢复。',
        )}`}
        confirmText={t('common.delete', '删除')}
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setDeleteConfirm({ open: false, exam: null })}
      />

      {/* 班级成绩单打印预览 */}
      {gradeSheet.sheet && (
        <PrintOverlay
          title={`${t('print.gradeSheet.title', '成绩单')} — ${gradeSheet.sheet.exam.name}`}
          onClose={gradeSheet.closeSheet}
        >
          <ClassGradeSheetDocument
            exam={gradeSheet.sheet.exam}
            subjects={subjects}
            rows={gradeSheet.sheet.rows}
            subjectStats={gradeSheet.sheet.subjectStats}
            classLabel={sheetClassLabel(gradeSheet.sheet.rows, classIdToName)}
          />
        </PrintOverlay>
      )}
    </div>
  )
}

/** 全部学生同属一个班级时返回该班级显示名,否则 undefined(逐行显示班级列) */
function sheetClassLabel(
  rows: Array<{ classId: string | null }>,
  classIdToName?: Record<string, string>,
): string | undefined {
  const classIds = [...new Set(rows.map((r) => r.classId))]
  if (classIds.length !== 1 || !classIds[0]) return undefined
  return classIdToName?.[classIds[0]] ?? classIds[0]
}
